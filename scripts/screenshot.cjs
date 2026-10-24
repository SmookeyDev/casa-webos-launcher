const { chromium } = require('./dependencies.cjs')('playwright');
(async()=>{
 const browser=await chromium.launch(require('./browser-options.cjs')());
 const page=await browser.newPage({viewport:{width:1920,height:1080}});
 page.on('pageerror',e=>process.stdout.write('ERROR '+e.message+'\n'));
 await page.goto('http://127.0.0.1:4187');
 await page.waitForTimeout(500);
 await page.screenshot({path:'design/home-v1.png'});
 process.stdout.write(JSON.stringify(await page.evaluate(()=>({state:CasaLauncher.getState(),focus:document.activeElement.id,overflow:document.documentElement.scrollWidth>innerWidth,images:[...document.images].map(i=>({src:i.getAttribute('src'),width:i.naturalWidth}))})),null,2));
 await browser.close();
})();
