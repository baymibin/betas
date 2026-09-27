// Export generated wing artwork to the game's existing 4x2 atlas contract.
const sharp = require('../backups/visual/image-tools/node_modules/sharp');
const fs = require('node:fs/promises');
const path = require('node:path');
const source = 'C:/Users/kazaf/.codex/generated_images/01a0a6e1-54e6-7400-8347-e3a8c4182deb';
const sheets = [
  ['bat_demon', 'exec-bbfb6faa-50f3-4c70-8928-4eb656dddc06.png', [284,286,284,283,232,237,242,240]],
  ['crimson_butterfly', 'exec-59e489de-c1d7-4d34-beaa-0bd3f6f60afe.png', [322,318,315,318,247,248,247,247]],
  ['dark_demon', 'exec-936af0f0-ff8b-40e2-a37b-607dd6fa11ee.png', [270,267,261,262,222,225,225,225]],
  ['mechanical_demon', 'exec-6616f079-d0a4-4ce8-9486-acdc417797b8.png', [284,278,279,278,287,287,287,287]],
];
const projectRoot = path.resolve(__dirname, '../..');
const wingRoot = path.join(projectRoot, 'client/assets/images/wings');
const backupRoot = path.join(__dirname, '../backups/visual/wings-original');
(async () => {
  await fs.mkdir(backupRoot, {recursive:true});
  for (const [name, file, pivots] of sheets) {
    const output = path.join(wingRoot, name + '_wings.webp');
    await fs.copyFile(output, path.join(backupRoot, path.basename(output)), fs.constants.COPYFILE_EXCL).catch(e => {if(e.code!=='EEXIST')throw e;});
    const input = path.join(source,file), meta = await sharp(input).metadata();
    const parts=[];
    for(let i=0;i<8;i++) {
      const col=i%4,row=Math.floor(i/4);
      const left=Math.round(col*meta.width/4),top=Math.round(row*meta.height/2);
      const width=Math.round((col+1)*meta.width/4)-left,height=Math.round((row+1)*meta.height/2)-top;
      // Uniform scale throughout the cycle; only registration shifts per pose.
      const w=Math.round(width*.5),h=Math.round(height*.5);
      const image=await sharp(input).extract({left,top,width,height}).resize(w,h).png().toBuffer();
      parts.push({input:image,left:col*256+Math.round(128-w/2),top:row*256+Math.round(144-pivots[i]*.5)});
    }
    await sharp({create:{width:1024,height:512,channels:4,background:'#00000000'}}).composite(parts).webp({lossless:true,effort:6}).toFile(output);
    const {data,info}=await sharp(output).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const bounds=[];
    for(let i=0;i<8;i++){
      let x0=256,y0=256,x1=-1,y1=-1;
      for(let y=0;y<256;y++)for(let x=0;x<256;x++){
        const a=data[((Math.floor(i/4)*256+y)*info.width+(i%4)*256+x)*4+3];
        if(a>16){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
      }
      if(x0<5||x1>250||y0<5||y1>250||x1<0)throw Error(output+' invalid frame '+i);
      bounds.push([x0,y0,x1,y1]);
    }
    console.log(output, '1024x512 RGBA, 8 frames:',JSON.stringify(bounds));
  }
})();
