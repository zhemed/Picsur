import { Injectable } from '@nestjs/common';
import createDOMPurify from 'dompurify';
import isSvg from 'is-svg';
import { JSDOM } from 'jsdom';
import { Failable, Fail, FT } from 'picsur-shared/dist/types/failable';
import { optimize } from 'svgo';

// DOMPurify needs a DOM to run in on the server. The window is stateless and
// shared between requests on purpose: the configured hooks below are constant.
const SvgDOMPurify = createDOMPurify(new JSDOM('').window);

// Only local fragment references and inline *raster* images are allowed.
// Anything else in `href`/`xlink:href` — `https:`, protocol relative,
// `javascript:`, `data:image/svg+xml`, `file:` — is a way for an uploaded SVG
// to reference remote or active content when a browser renders it, so it is
// dropped. This applies to every element, not just `use`: `<image
// href="https://…">` (and `<a href="https://…">`) reference content the same
// way.
const AllowedSvgHref =
  /^(#[^#]*|data:image\/(png|jpeg|jpg|gif|webp|avif|bmp|tiff);base64,[A-Za-z0-9+/=]*)$/;

SvgDOMPurify.addHook('afterSanitizeAttributes', (node) => {
  for (const attribute of ['xlink:href', 'href']) {
    const value = node.getAttribute(attribute);
    if (value !== null && !AllowedSvgHref.test(value.trim())) {
      node.removeAttribute(attribute);
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
