import { Marked } from 'marked';

export const direct = (href, image) => {
  if (href.startsWith('#') || /^\/(?!\/)/.test(href)) return href;
  if (href.startsWith('//')) throw new Error(`Unsafe URL: ${href}`);

  const scheme = href.match(/^([a-z][a-z\d+.-]*):/i)?.[1].toLowerCase();
  if (!scheme) return null;

  const allowed = image ? ['http', 'https'] : ['http', 'https', 'mailto'];
  if (!allowed.includes(scheme)) throw new Error(`Unsafe URL: ${href}`);
  return href;
};

export const parse = (markdown, walkTokens) =>
  new Marked({
    gfm: true,
    renderer: { html: () => '' },
    walkTokens
  }).parse(markdown);
