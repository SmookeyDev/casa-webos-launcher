const fs=require('node:fs');
const sharp=require('./dependencies.cjs')('sharp');
(async()=>{
 const p='app/assets/icons/catalog.json'; const apps=JSON.parse(fs.readFileSync(p,'utf8'));
 for(const app of apps){
  const {data,info}=await sharp('app/'+app.icon).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const points=[[0,0],[Math.floor(info.width/2),0],[0,Math.floor(info.height/2)]];
  const colors=points.map(([x,y])=>{let at=(y*info.width+x)*4;return [...data.slice(at,at+4)]});
  process.stdout.write(app.id+' '+JSON.stringify(colors)+'\n');
  const c=colors[0];if(c[3]>240)app.color='#'+c.slice(0,3).map(n=>n.toString(16).padStart(2,'0')).join('');
 }
 fs.writeFileSync(p,JSON.stringify(apps,null,2)+'\n');
 fs.writeFileSync('app/js/catalog.js','window.LauncherCatalog = '+JSON.stringify(apps,null,2)+';\n');
 const icon='<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" rx="60" fill="#14253b"/><path d="M65 119 128 65l63 54v68a8 8 0 0 1-8 8h-38v-49h-34v49H73a8 8 0 0 1-8-8Z" fill="none" stroke="#f2f5fa" stroke-width="10" stroke-linejoin="round"/></svg>';
 await sharp(Buffer.from(icon)).png().toFile('app/assets/icon.png');
})();
