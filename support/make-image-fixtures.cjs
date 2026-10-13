const sharp = require('sharp');
(async () => {
  const base = await sharp({create:{width:200,height:150,channels:4,background:{r:30,g:140,b:200,alpha:1}}}).png().toBuffer();
  const fs = require('fs');
  fs.writeFileSync('/out/base.png', base);
  for (const [name, buf] of [
    ['webp', await sharp(base).webp().toBuffer()],
    ['avif', await sharp(base).avif().toBuffer()],
    ['jxl', await sharp(base).jxl().toBuffer()],
    ['jp2', await sharp(base).jp2().toBuffer()],
    ['heif', await sharp(base).heif({compression:'av1'}).toBuffer()],
    ['jpg', await sharp(base).jpeg().toBuffer()],
  ]) fs.writeFileSync('/out/base.' + name, buf);
  const QOIencode = require('qoi-img').QOIencode;
  const r = await sharp(base).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  fs.writeFileSync('/out/base.qoi', QOIencode(r.data, {width:r.info.width, height:r.info.height, channels:r.info.channels}));
  console.log('generated:', fs.readdirSync('/out').join(' '));
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
