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

    if (activeCheckSessions.has(req.session.userId)) {
        const oldSession = activeCheckSessions.get(req.session.userId);
        try { await oldSession.browser.close(); } catch(e){}
        activeCheckSessions.delete(req.session.userId);
    }

    try {
        const browser = await puppeteer.launch({ 
            headless: true, 
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();

        await page.goto('https://rta.government.bg/services/check-inspection/index.html', { waitUntil: 'networkidle2' });

        await page.waitForSelector('.captcha img');

        const captchaElement = await page.$('.captcha img');
        const captchaImageBase64 = await captchaElement.screenshot({ encoding: 'base64' });
        
        activeCheckSessions.set(req.session.userId, { browser, page });

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

router.get('/check/insurance/:id', requireLogin, async (req, res) => {
    const car = await getCar(req, res);
    if (!car)
        return;
    
    res.render('checks/insurance', { car, result: null, error: null, loading: false });
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

router.get('/check/vignette/:id', requireLogin, async (req, res) => {
    const car = await getCar(req, res);
    if (!car) return;
    res.render('checks/vignette', { car, result: null, error: null, loading: false });
});

router.post('/check/vignette/:id', requireLogin, async (req, res) => {
    const car = await getCar(req, res);
    if (!car) return;

    const targetUrl = 'https://check.bgtoll.bg/';
    let browser = null;

    try {
        browser = await puppeteer.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080']
        });

        const pages = await browser.pages();
        const page = pages[0];
        await page.setViewport({ width: 1920, height: 1080 });

        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });

        await page.waitForSelector('.CarRegistrationForm input', { timeout: 15000 });

        const cleanPlate = car.regPlate.replace(/\s+/g, '').toUpperCase();
        
        await page.click('.CarRegistrationForm input');
        await page.type('.CarRegistrationForm input', cleanPlate, { delay: 100 });

        await page.click('.CarRegistrationForm .btn-success');
        
        try {
            await page.waitForSelector('.CheckResult', { visible: true, timeout: 10000 });
        } catch (e) {
            throw new Error("Няма намерени данни или сайтът не отговаря.");
        }

        const resultHTML = await page.evaluate(() => {
            
            const table = document.querySelector('.CheckResult table');
            
            if (!table) {
                
                return `<div class="text-center bg-red-50 p-6 rounded-lg border border-red-100">
                            <i class="fas fa-times-circle text-red-500 text-3xl mb-3"></i>
                            <h3 class="text-lg font-bold text-red-700">Няма активна винетка</h3>
                            <p class="text-red-600 text-sm mt-1">За този автомобил не са намерени данни за електронна винетка.</p>
                        </div>`;
            }
            
            const rows = Array.from(table.querySelectorAll('tbody tr'));
            
            let htmlCards = '';

            rows.forEach(row => {
                const cells = row.querySelectorAll('td');
                
                const vignetteId = cells[0]?.innerText || '-';
                const startDate = cells[3]?.innerText || '-';
                const endDate = cells[4]?.innerText || '-';
                const statusElement = cells[6]?.querySelector('span');
                const statusText = statusElement?.innerText.trim() || 'Неизвестен';
                const price = cells[5]?.innerText || '-';

                const isActive = statusText.toLowerCase().includes('активна');
                const statusColor = isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600';

                htmlCards += `
                    <div class="bg-gray-50 rounded-lg p-4 mb-4 border border-gray-200">
                        <div class="flex justify-between items-start border-b border-gray-200 pb-3 mb-3">
                            <div>
                                <span class="text-xs text-gray-500 uppercase tracking-wide">ID на винетка</span>
                                <div class="font-mono font-bold text-gray-800 text-lg">${vignetteId}</div>
                            </div>
                            <span class="px-3 py-1 rounded-full text-xs font-bold uppercase ${statusColor}">
                                ${statusText}
                            </span>
                        </div>
                        
                        <div class="grid grid-cols-2 gap-4 text-sm">
                            <div>
                                <span class="text-gray-500 block">Валидна от</span>
                                <span class="font-semibold text-gray-900">${startDate}</span>
                            </div>
                            <div>
                                <span class="text-gray-500 block">Валидна до</span>
                                <span class="font-semibold text-gray-900">${endDate}</span>
                            </div>
                            <div class="col-span-2 mt-2 pt-2 border-t border-gray-200 flex justify-between">
                                <span class="text-gray-500">Цена</span>
                                <span class="font-bold text-gray-900">${price}</span>
                            </div>
                        </div>
                    </div>
                `;
            });

            return htmlCards;
        });

        await browser.close();

        res.render('checks/vignette', { 
            car, 
            result: resultHTML, 
            error: null,
            loading: false
        });

    } catch (err) {
        console.error("Vignette Error:", err);
        if (browser) await browser.close();
        res.render('checks/vignette', { 
            car, 
            result: null, 
            error: 'Възникна грешка при връзката с BG Toll.',
            loading: false
        });
    }
});

const User = require('../models/User');

router.get('/check/fines/:id', requireLogin, async (req, res) => {
    const car = await getCar(req, res);
    const user = await User.findById(req.session.userId);
    
    if (!car || !user) return;

    const hasData = user.egn && user.sumps && user.egn.length === 10 && user.sumps.length === 9;

    res.render('checks/fines', { 
        car, 
        user,
        hasData,
        result: null, 
        error: null, 
        loading: false 
    });
});

router.post('/check/fines/:id', requireLogin, async (req, res) => {
    const car = await getCar(req, res);
    const user = await User.findById(req.session.userId);
    if (!car || !user) return;
    if (!user.egn || !user.sumps) return res.redirect('/profile');

    const targetUrl = 'https://e-uslugi.mvr.bg/services/obligations';
    let browser = null;

    try {
        browser = await puppeteer.launch({ 
            headless: true, // Скрит режим
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080']
        });

        const pages = await browser.pages();
        const page = pages[0];
        await page.setViewport({ width: 1920, height: 1080 });

        // 1. Зареждане
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        // 2. Попълване на ЕГН (Robust method)
        await page.waitForSelector('#obligedPersonIdent', { timeout: 30000 });
        await page.click('#obligedPersonIdent');
        await page.type('#obligedPersonIdent', user.egn, { delay: 100 });

        // 3. Избор на СУМПС
        await page.select('#additionalData', '1');
        await new Promise(r => setTimeout(r, 500)); // Кратка пауза за React

        // 4. Попълване на СУМПС
        await page.waitForSelector('#drivingLicenceNumber', { visible: true });
        await page.click('#drivingLicenceNumber');
        await page.type('#drivingLicenceNumber', user.sumps, { delay: 100 });
        
        // Симулираме натискане на TAB, за да потвърдим полето
        await page.keyboard.press('Tab');
        await new Promise(r => setTimeout(r, 500));

        // 5. Клик на бутона
        await page.evaluate(() => {
            const btn = document.querySelector('button.btn-primary');
            if(btn) btn.click();
        });

        // 6. Изчакване на резултат (Игнорираме инструкциите)
        try {
            await page.waitForFunction(() => {
                const alerts = Array.from(document.querySelectorAll('.alert-info'));
                const instructionText = "В резултата от проверката ще се визуализират";
                // Връща true, ако намерим alert, който НЕ е инструкцията
                return alerts.some(el => !el.innerText.includes(instructionText));
            }, { timeout: 30000 });
        } catch(e) {
            // Ако тайм-аутне, пак пробваме да четем, може просто да е бавно
        }

        // 7. Извличане и Анализ
        const resultData = await page.evaluate(() => {
            const alerts = Array.from(document.querySelectorAll('.alert-info'));
            let messages = alerts.map(el => el.innerText.trim());

            // Филтрираме инструкцията
            const instructionPhrase = "В резултата от проверката ще се визуализират";
            messages = messages.filter(msg => !msg.includes(instructionPhrase));

            // Ако след филтъра няма нищо -> проблем или още зарежда
            if (messages.length === 0) return null;

            const successPhrase = "няма данни за неплатени задължения";
            const isClean = messages.some(msg => msg.includes(successPhrase));

            return {
                hasFines: !isClean,
                messages: messages
            };
        });

        await browser.close();

        if (!resultData) {
            throw new Error("Не получихме валиден отговор от системата на МВР.");
        }

        res.render('checks/fines', { 
            car, user, hasData: true, result: resultData, error: null, loading: false 
        });

    } catch (err) {
        console.error("MVR Error:", err.message);
        if (browser) await browser.close();
        
        res.render('checks/fines', { 
            car, user, hasData: true, result: null, 
            error: 'Възникна грешка при проверката. Моля опитайте отново по-късно.', 
            loading: false 
        });
    }
});

module.exports = router;