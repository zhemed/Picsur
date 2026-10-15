import { AsyncFailable, Fail, FT } from 'picsur-shared/dist/types/failable';
import { QOIdecodeJS } from '../util/qoi/qoi-decode';
import { QOIImage } from './qoi-worker.dto';

export default async function qoiDecodeJob(
  url: string,
  authorization: string,
): AsyncFailable<QOIImage> {
  try {
    const response = await fetch(url, {
      headers: {
        Authorization: authorization,
      },
    });
    if (!response.ok) {
      return Fail(FT.Network, 'workers.couldNotFetchImage');
    }

    const buffer = await response.arrayBuffer();

    const image = QOIdecodeJS(buffer, null, null, 4);

    const imageData = new ImageData(
      // TS >=5.7 types typed arrays by their backing buffer; the QOI decoder
      // always allocates a plain ArrayBuffer, and ImageData refuses anything
      // that could be a SharedArrayBuffer.
      new Uint8ClampedArray(image.data.buffer as ArrayBuffer),
      image.width,
      image.height,
    );

    return {
      data: imageData,
      width: image.width,
      height: image.height,
    };
  } catch (e) {
    return Fail(FT.Internal, e);
  }
}
