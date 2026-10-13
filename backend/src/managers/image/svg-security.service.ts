import { Injectable } from '@nestjs/common';
import createDOMPurify from 'dompurify';
import isSvg from 'is-svg';
import { JSDOM } from 'jsdom';
import { Failable, Fail, FT } from 'picsur-shared/dist/types/failable';
import { optimize } from 'svgo';

// DOMPurify needs a DOM to run in on the server. The window is stateless and
// shared between requests on purpose: the configured hooks below are constant.
const SvgDOMPurify = createDOMPurify(new JSDOM('').window);

// `use` is allowed (it is how SVG symbols/sprites are composed), but only with
// local fragment references. An external `xlink:href`/`href` would let an
// uploaded SVG pull in remote content when a browser renders it.
SvgDOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName && node.tagName.toLowerCase() === 'use') {
    const xlinkHref = node.getAttribute('xlink:href');
    if (xlinkHref && !xlinkHref.startsWith('#')) {
      node.removeAttribute('xlink:href');
    }
    const href = node.getAttribute('href');
    if (href && !href.startsWith('#')) {
      node.removeAttribute('href');
    }
  }
});

/**
 * Sanitizes and optimizes uploaded SVG files.
 *
 * SVG is stored verbatim (it cannot go through the raster transcode pipeline),
 * so this is the only place where untrusted markup is made safe. See
 * `getConverted()`/the image controller for the response headers that provide
 * the second layer of defence.
 */
@Injectable()
export class SvgSecurityService {
  public sanitize(image: Buffer): Failable<Buffer> {
    try {
      const result = optimize(image.toString('utf8'), {
        multipass: true,
        plugins: ['preset-default', 'removeScripts'],
      });

      const sanitized = SvgDOMPurify.sanitize(result.data, {
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: ['foreignObject', 'script', 'iframe', 'object', 'embed'],
        ADD_TAGS: ['use'],
        ADD_ATTR: ['xlink:href', 'href'],
        RETURN_TRUSTED_TYPE: false,
      });

      if (!isSvg(sanitized)) {
        return Fail(
          FT.UsrValidation,
          'Invalid SVG file',
          'Sanitized SVG output is not valid SVG',
        );
      }

      return Buffer.from(sanitized, 'utf8');
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      return Fail(FT.UsrValidation, 'Invalid SVG file', reason);
    }
  }
}
