const express = require('express');
const router = express.Router();
const Vehicle = require('../models/Vehicle');
const puppeteer = require('puppeteer');

// Съхраняваме активните сесии на Puppeteer (Browser Pages)
// Key: UserID, Value: { browser, page }
const activeCheckSessions = new Map();

const requireLogin = (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    next();
};

async function getCar(req, res) {
    try {
        const car = await Vehicle.findOne({ _id: req.params.id, owner: req.session.userId });
        if (!car) {
            res.redirect('/dashboard');
            return null;
        }
        return car;
    } catch (err) {
        console.error(err);
        res.redirect('/dashboard');
        return null;
    }
}

// --------------------------------------------------------
// 1. GET: Зареждане на страницата и вземане на CAPTCHA
// --------------------------------------------------------
router.get('/check/inspection/:id', requireLogin, async (req, res) => {
    const car = await getCar(req, res);
    if (!car) return;

    // Ако има стара отворена сесия за този потребител, я затваряме
    if (activeCheckSessions.has(req.session.userId)) {
        const oldSession = activeCheckSessions.get(req.session.userId);
        try { await oldSession.browser.close(); } catch(e){}
        activeCheckSessions.delete(req.session.userId);
    }

    try {
        // 1. Стартираме скрит браузър
        const browser = await puppeteer.launch({ 
            headless: true, // Промени на false, ако искаш да гледаш какво става (за дебъг)
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();

        // 2. Отиваме на официалния сайт
        await page.goto('https://rta.government.bg/services/check-inspection/index.html', { waitUntil: 'networkidle2' });

        // 3. Чакаме картинката на капчата да се зареди
        await page.waitForSelector('.captcha img');

        // 4. Взимаме елемента на капчата и правим скрийншот (Base64)
        const captchaElement = await page.$('.captcha img');
        const captchaImageBase64 = await captchaElement.screenshot({ encoding: 'base64' });

        // 5. Запазваме сесията, за да я ползваме в POST заявката
        activeCheckSessions.set(req.session.userId, { browser, page });

        // 6. Рендираме нашата страница с картинката
        res.render('checks/inspection', { 
            car, 
            captchaImage: `data:image/png;base64,${captchaImageBase64}`,
            error: null,
            result: null
        });

    } catch (error) {
        console.error("Puppeteer Error:", error);
        res.render('checks/inspection', { car, captchaImage: null, error: 'Грешка при връзка със системата на ИААА.', result: null });
    }
});

// --------------------------------------------------------
// 2. POST: Изпращане на данните и получаване на резултат
// --------------------------------------------------------
router.post('/check/inspection/:id', requireLogin, async (req, res) => {
    const car = await getCar(req, res);
    if (!car) return;

    const { captchaCode } = req.body;
    const session = activeCheckSessions.get(req.session.userId);

    if (!session) {
        return res.render('checks/inspection', { car, captchaImage: null, error: 'Сесията изтече. Моля, презаредете страницата.', result: null });
    }

    const { browser, page } = session;

    try {
        // 1. Попълваме регистрационния номер (махаме интервалите)
        const cleanPlate = car.regPlate.replace(/\s+/g, '').toUpperCase();
        
        // Намираме полето за рег. номер (Knockout bind-ва input-а)
        // В HTML-а е input с placeholder "Рег. номер"
        await page.type('input[placeholder="Рег. номер"]', cleanPlate);

        // 2. Попълваме Капчата
        // В HTML-а е input с placeholder "Код"
        await page.type('input[placeholder="Код"]', captchaCode);

        // 3. Натискаме бутона "Провери" (.submit)
        await page.click('a.submit');

        // 4. Чакаме резултат
        // Резултатът се появява в div с клас "result" и под-дивове "resultYes" или "resultNo"
        try {
            await page.waitForSelector('.result', { visible: true, timeout: 5000 });
            // Чакаме малко Knockout да обнови DOM-а
            await new Promise(r => setTimeout(r, 1000));
        } catch (e) {
            throw new Error('Времето за изчакване изтече или капчата е грешна.');
        }

        // 5. Проверяваме за грешка (напр. грешна капча)
        const isCaptchaError = await page.$('.captchaInput.error');
        if (isCaptchaError) {
            throw new Error('Грешен код за сигурност (Captcha). Опитайте отново.');
        }

        // 6. Извличаме данните (Scraping)
        // Проверяваме дали има успех (resultYes е видим)
        const successElement = await page.$('.resultYes');
        const failElement = await page.$('.resultNo');
        
        let resultData = {};

        if (successElement && await successElement.isVisible()) {
            // УСПЕШЕН ПРЕГЛЕД
            const extracted = await page.evaluate(() => {
                const container = document.querySelector('.resultYes');
                // Взимаме всички елементи с клас "reg"
                const regElements = container.querySelectorAll('.reg');
                const vinElement = container.querySelector('var[data-bind*="rvIdentNumber"]');
                
                // HTML СТРУКТУРА СПОРЕД ТВОЯ КОД:
                // regElements[0] -> Рег. номер (CT4373PP)
                // regElements[1] -> Еко група (4)
                // regElements[2] -> Текст "валиден до" (НЕНУЖЕН)
                // regElements[3] -> Датата (17.05.2026)

                return {
                    plate: regElements[0]?.innerText.trim(),
                    eco: regElements[1]?.innerText.trim() || '-',
                    // ВЗИМАМЕ ИНДЕКС 3 ЗА ДАТАТА:
                    date: regElements[3]?.innerText.trim(), 
                    vin: vinElement?.innerText.trim()
                };
            });

            // Форматираме текста както ти поиска
            const formattedHTML = `
                Превозното средство с регистрационен номер <b>${extracted.plate}</b> с <b>ЕКО Група ${extracted.eco}</b><br>
                <b>Има</b> валиден периодичен технически преглед!<br><br>
                Валиден до <b>${extracted.date}</b><br>
                Идент. № (VIN, рама): ${extracted.vin}
            `;

            resultData = { success: true, text: formattedHTML };

        } else if (failElement && await failElement.isVisible()) {
            // НЕУСПЕШЕН / ИЗТЕКЪЛ ПРЕГЛЕД
            // Структурата при resultNo е идентична за датите
            const extractedFail = await page.evaluate(() => {
                const container = document.querySelector('.resultNo');
                const regElements = container.querySelectorAll('.reg');
                const vinElement = container.querySelector('var[data-bind*="rvIdentNumber"]');

                return {
                    plate: regElements[0]?.innerText.trim(),
                    // При resultNo датата на изтичане пак е на индекс 3 ("изтекъл на" е индекс 2)
                    date: regElements[3]?.innerText.trim(),
                    vin: vinElement?.innerText.trim()
                };
            });

            const formattedFailHTML = `
                Превозното средство с регистрационен номер <b>${extractedFail.plate}</b><br>
                <b style="color:red">НЯМА</b> валиден периодичен технически преглед!<br><br>
                Изтекъл на <b>${extractedFail.date}</b><br>
                Идент. № (VIN, рама): ${extractedFail.vin}
            `;

            resultData = { success: false, text: formattedFailHTML };
        } else {
             // ... грешките остават същите
             const regError = await page.$('.vehicleRegistrationNumber.error');
             if(regError) throw new Error('Невалиден формат на регистрационния номер.');
             throw new Error('Неуспешно разчитане на резултата.');
        }

        // 7. Затваряме браузъра и връщаме отговор
        await browser.close();
        activeCheckSessions.delete(req.session.userId);

        res.render('checks/inspection', { 
            car, 
            captchaImage: null, 
            error: null, 
            result: resultData 
        });

    } catch (err) {
        console.error("Check Error:", err);
        // При грешка затваряме браузъра
        await browser.close();
        activeCheckSessions.delete(req.session.userId);

        res.render('checks/inspection', { 
            car, 
            captchaImage: null, // Трябва рефреш за нова капча
            error: err.message, 
            result: null 
        });
    }
});

// Другите routes (Placeholder)
router.get('/check/insurance/:id', requireLogin, async (req, res) => { /* ... */ res.send("Скоро"); });
router.get('/check/vignette/:id', requireLogin, async (req, res) => { /* ... */ res.send("Скоро"); });
router.get('/check/fines/:id', requireLogin, async (req, res) => { /* ... */ res.send("Скоро"); });

module.exports = router;