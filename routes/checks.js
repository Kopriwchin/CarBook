const express = require('express');
const router = express.Router();
const Vehicle = require('../models/Vehicle');

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

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

router.post('/check/insurance/:id', requireLogin, async (req, res) => {
    const car = await getCar(req, res);
    if (!car) {
        return;
    }

    const targetUrl = 'https://www.guaranteefund.org/bg/%D0%B8%D0%BD%D1%84%D0%BE%D1%80%D0%BC%D0%B0%D1%86%D0%B8%D0%BE%D0%BD%D0%B5%D0%BD-%D1%86%D0%B5%D0%BD%D1%82%D1%8A%D1%80-%D0%B8-%D1%81%D0%BF%D1%80%D0%B0%D0%B2%D0%BA%D0%B8/%D1%83%D1%81%D0%BB%D1%83%D0%B3%D0%B8/%D0%BF%D1%80%D0%BE%D0%B2%D0%B5%D1%80%D0%BA%D0%B0-%D0%B7%D0%B0-%D0%B2%D0%B0%D0%BB%D0%B8%D0%B4%D0%BD%D0%B0-%D0%B7%D0%B0%D1%81%D1%82%D1%80%D0%B0%D1%85%D0%BE%D0%B2%D0%BA%D0%B0-%D0%B3%D1%80a%D0%B6%D0%B4a%D0%BD%D1%81%D0%BAa-%D0%BE%D1%82%D0%B3%D0%BE%D0%B2%D0%BE%D1%80%D0%BD%D0%BE%D1%81%D1%82-%D0%BD%D0%B0-%D0%B0%D0%B2%D1%82%D0%BE%D0%BC%D0%BE%D0%B1%D0%B8%D0%BB%D0%B8%D1%81%D1%82%D0%B8%D1%82%D0%B5';

    let browser = null;
    let page = null;

    try {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--window-size=1920,1080'
            ]
        });

        page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });

        await page.goto(targetUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        await page.waitForSelector('#dkn', { timeout: 30000 });
        const cleanPlate = car.regPlate.replace(/\s+/g, '').toUpperCase();
        await page.type('#dkn', cleanPlate, { delay: 60 });

        const altchaCheckbox = 'input[name="altcha_checkbox"]';
        if (await page.$(altchaCheckbox)) {
            await page.click(altchaCheckbox);

            try {
                await page.waitForFunction(() => {
                    const el = document.querySelector('.altcha');
                    return el && el.getAttribute('data-state') === 'verified';
                }, { timeout: 20000 });
            } catch (_) {
                // ако таймне – продължаваме, понякога става async
            }
        }

        await page.click('input[name="send"]');

        await page.waitForFunction(() => {
            return document.querySelector('#printresult');
        }, { timeout: 20000 });

        const insuranceData = await page.evaluate(() => {
            const container = document.querySelector('#printresult');
            if (!container) {
                return { found: false };
            }

            const statusText = container.querySelector('h6')?.innerText || '';

            const table = container.querySelector('table.success-results');
            if (!table) {
                return {
                    found: false,
                    message: statusText || 'Няма намерена активна застраховка'
                };
            }

            const cells = table.querySelectorAll('tbody tr td');

            return {
                found: true,
                active: statusText.includes('има валидна'),
                insurer: cells[0]?.innerText.trim() || '',
                startDate: cells[1]?.innerText.replace(/\s+/g, ' ').trim() || '',
                endDate: cells[2]?.innerText.replace(/\s+/g, ' ').trim() || ''
            };
        });

        let resultHtml = null;

        if (insuranceData.found && insuranceData.active) {
            resultHtml = `
                <div class="space-y-3">
                    <div class="flex justify-between border-b pb-2">
                        <span class="text-gray-500">Статус</span>
                        <span class="font-bold text-green-600">Активна</span>
                    </div>
                    <div class="flex justify-between border-b pb-2">
                        <span class="text-gray-500">Застраховател</span>
                        <span class="font-bold text-gray-900">${insuranceData.insurer}</span>
                    </div>
                    <div class="flex justify-between border-b pb-2">
                        <span class="text-gray-500">Валидна от</span>
                        <span>${insuranceData.startDate}</span>
                    </div>
                    <div class="flex justify-between pt-2">
                        <span class="text-gray-500">Валидна до</span>
                        <span class="font-bold">${insuranceData.endDate}</span>
                    </div>
                </div>
            `;
        } else {
            resultHtml = `
                <div class="text-center text-red-600 font-bold">
                    ❌ Няма активна застраховка
                </div>
            `;
        }

        await browser.close();

        return res.render('checks/insurance', {
            car,
            result: resultHtml,
            error: null,
            loading: false
        });

    } catch (err) {
        console.error('Insurance check error:', err);

        if (page) {
            try {
                await page.screenshot({
                    path: 'ERROR_SNAPSHOT.png',
                    fullPage: true
                });
            } catch (_) {}
        }

        if (browser) {
            await browser.close();
        }

        return res.render('checks/insurance', {
            car,
            result: null,
            error: 'Възникна грешка при проверката. Виж ERROR_SNAPSHOT.png',
            loading: false
        });
    }
});

router.get('/check/insurance/:id', requireLogin, async (req, res) => {
    const car = await getCar(req, res);
    if (!car)
        return;
    
    res.render('checks/insurance', { car, result: null, error: null, loading: false });
});

router.post('/check/insurance/:id', requireLogin, async (req, res) => {
    const car = await getCar(req, res);
    if (!car) return;

    // Използваме encodeURI, за да сме сигурни, че кирилицата в адреса не чупи Puppeteer
    const targetUrl = encodeURI('https://www.guaranteefund.org/bg/%D0%B8%D0%BD%D1%84%D0%BE%D1%80%D0%BC%D0%B0%D1%86%D0%B8%D0%BE%D0%BD%D0%B5%D0%BD-%D1%86%D0%B5%D0%BD%D1%82%D1%8A%D1%80-%D0%B8-%D1%81%D0%BF%D1%80%D0%B0%D0%B2%D0%BA%D0%B8/%D1%83%D1%81%D0%BB%D1%83%D0%B3%D0%B8/%D0%BF%D1%80%D0%BE%D0%B2%D0%B5%D1%80%D0%BA%D0%B0-%D0%B7%D0%B0-%D0%B2%D0%B0%D0%BB%D0%B8%D0%B4%D0%BD%D0%B0-%D0%B7%D0%B0%D1%81%D1%82%D1%80%D0%B0%D1%85%D0%BE%D0%B2%D0%BA%D0%B0-%D0%B3%D1%80%D0%B0%D0%BD%D0%B8%D1%87%D0%BD%D0%B0-%D0%B3%D1%80%D0%B0%D0%B6%D0%B4%D0%B0%D0%BD%D1%81%D0%BA%D0%B0-%D0%BE%D1%82%D0%B3%D0%BE%D0%B2%D0%BE%D1%80%D0%BD%D0%BE%D1%81%D1%82#validgo');

    let browser = null;

    try {
        // 1. Стартираме браузъра във ВИДИМ режим (за да дебъгваш)
        browser = await puppeteer.launch({ 
            headless: false, // ВАЖНО: Виждаш браузъра на екрана си
            defaultViewport: null, // Използва целия прозорец
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--window-size=1280,800', // Стандартен размер на прозореца
                '--start-maximized'
            ]
        });

        const page = await browser.newPage();
        
        // 2. Представяме се за истински Chrome браузър (User Agent Spoofing)
        // Това е критично, за да не ни блокират
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        console.log("Navigating to GF...");
        
        // 3. Зареждане на страницата с по-голям timeout (60 сек)
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // Понякога формата е в iframe или се зарежда динамично. 
        // Чакаме малко повече, за да се уверим, че скриптовете на сайта са сработили.
        // Тук търсим ID-то на формата, не само на инпута, за по-сигурно.
        console.log("Waiting for form...");
        await page.waitForSelector('#dkn', { visible: true, timeout: 30000 });

        console.log("Form found. Typing plate...");
        
        // 4. Попълване на Рег. номер
        const cleanPlate = car.regPlate.replace(/\s+/g, '').toUpperCase();
        
        // Пишем бавно, като човек (delay: 100ms)
        await page.type('#dkn', cleanPlate, { delay: 100 });

        // 5. Справяне с ALTCHA
        const altchaSelector = 'input[name="altcha_checkbox"]';
        
        // Проверяваме дали Altcha съществува
        const altchaExists = await page.$(altchaSelector);
        if (altchaExists) {
            console.log("Clicking Altcha...");
            await page.click(altchaSelector);
            
            // Чакаме верификация (до 20 секунди)
            // Търсим елемент, който показва, че проверката е минала
            try {
                await page.waitForFunction(() => {
                    const el = document.querySelector('.altcha');
                    return el && el.getAttribute('data-state') === 'verified';
                }, { timeout: 20000 });
                console.log("Altcha verified!");
            } catch (e) {
                console.log("Warning: Altcha verify check timed out, trying to submit anyway...");
            }
        } else {
            console.log("Altcha not found on page?");
        }

        // 6. Изпращане (Кликаме бутона "Търси")
        await page.click('input[name="send"]');

        console.log("Submitted. Waiting for results...");

        // 7. Чакаме резултата
        // Важно: Тук чакаме нещо да се промени. 
        // Ако сайтът презарежда страницата, използваме waitForNavigation
        // Ако сайтът ползва AJAX, чакаме селектор.
        // При ГФ обикновено формата изчезва или се появява съобщение.
        
        // Изчакваме мрежовата активност да утихне
        try {
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 });
        } catch(e) {
            // Ако не навигира, значи е обновило DOM-а на място
        }

        // 8. Взимаме HTML-а на резултата
        const resultHTML = await page.evaluate(() => {
            // Опитваме се да намерим контейнера с резултата
            // Често ГФ връща резултата в <div class="article-content"> или подобно
            
            // Проверяваме за грешки на екрана
            const errorMsg = document.querySelector('.system_msg'); // Пример
            if (errorMsg) return `<b style="color:red">${errorMsg.innerText}</b>`;

            // Проверяваме за таблица с резултати
            const resultTable = document.querySelector('table'); 
            // Взимаме бодито, за да видим какво е станало, ако няма специфичен селектор
            const content = document.querySelector('.article-content') || document.body;
            
            // Чистим формата, за да не я показваме
            const form = content.querySelector('form');
            if (form) form.remove();

            return content.innerHTML;
        });

        await browser.close();

        res.render('checks/insurance', { 
            car, 
            result: resultHTML, 
            error: null,
            loading: false
        });

    } catch (err) {
        console.error("Puppeteer Error:", err);
        
        // Правим снимка на грешката, за да я видиш във папката на проекта!
        if (browser) {
            const pages = await browser.pages();
            if (pages.length > 0) {
                await pages[0].screenshot({ path: 'debug-error.png' });
                console.log("Screenshot saved to debug-error.png");
            }
            await browser.close();
        }

        res.render('checks/insurance', { 
            car, 
            result: null, 
            error: 'Грешка: ' + err.message,
            loading: false
        });
    }
});

router.get('/check/vignette/:id', requireLogin, async (req, res) => { res.send("Скоро"); });

router.get('/check/fines/:id', requireLogin, async (req, res) => { res.send("Скоро"); });

module.exports = router;