export const GPT_IMAGE_SIZE_MAP: Record<string, string> = {
  '1:1_1k': '1024x1024',
  '1:1_2k': '2048x2048',
  '1:1_4k': '2880x2880',
  '3:2_1k': '1248x832',
  '3:2_2k': '2496x1664',
  '3:2_4k': '3504x2336',
  '2:3_1k': '832x1248',
  '2:3_2k': '1664x2496',
  '2:3_4k': '2336x3504',
  '4:3_1k': '1152x864',
  '4:3_2k': '2304x1728',
  '4:3_4k': '3264x2448',
  '3:4_1k': '864x1152',
  '3:4_2k': '1728x2304',
  '3:4_4k': '2448x3264',
  '5:4_1k': '1120x896',
  '5:4_2k': '2240x1792',
  '5:4_4k': '3200x2560',
  '4:5_1k': '896x1120',
  '4:5_2k': '1792x2240',
  '4:5_4k': '2560x3200',
  '16:9_1k': '1280x720',
  '16:9_2k': '2560x1440',
  '16:9_4k': '3840x2160',
  '9:16_1k': '720x1280',
  '9:16_2k': '1440x2560',
  '9:16_4k': '2160x3840',
  '2:1_1k': '2048x1024',
  '2:1_2k': '2688x1344',
  '2:1_4k': '3840x1920',
  '1:2_1k': '1024x2048',
  '1:2_2k': '1344x2688',
  '1:2_4k': '1920x3840',
  '21:9_1k': '1456x624',
  '21:9_2k': '3024x1296',
  '21:9_4k': '3696x1584',
  '9:21_1k': '624x1456',
  '9:21_2k': '1296x3024',
  '9:21_4k': '1584x3696',
};

export function getGptImagePixelSize(aspectRatio: string | undefined, sizeLevel: string | undefined): string {
  const ar = String(aspectRatio || '').trim();
  const safeAr = !ar || ar === 'Auto' || ar === 'AUTO' || ar === 'empty' ? '1:1' : ar;
  const level = String(sizeLevel || '1K').toLowerCase();
  return GPT_IMAGE_SIZE_MAP[`${safeAr}_${level}`] || '1024x1024';
}

export function isGptImageSizeKind(paramKind: string | undefined): boolean {
  return paramKind === 'gpt-size';
}

