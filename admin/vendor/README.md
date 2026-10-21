# Bundled browser libraries

These assets are served locally so the authoring page loads no third-party scripts.
No npm dependencies or package manager are required in the Hugo repository.

| Library | Version | Bundled asset | License |
| --- | --- | --- | --- |
| [js-yaml](https://github.com/nodeca/js-yaml) | 4.1.1 | js-yaml.min.js | LICENSE.js-yaml (MIT) |
| [markdown-it](https://github.com/markdown-it/markdown-it) | 15.0.3 | markdown-it.min.js | LICENSE.markdown-it (MIT) |
| [DOMPurify](https://github.com/cure53/DOMPurify) | 3.4.17 | purify.min.js | LICENSE.dompurify (Apache-2.0 option) |
| [LXGW WenKai Screen](https://github.com/chawyehsu/lxgw-wenkai-webfont) | 1.7.0 | wenkai/font.css and its 97 referenced WOFF2 subsets | wenkai/LICENSE (MIT), wenkai/OFL.txt (font OFL-1.1) |
| [KaTeX](https://github.com/KaTeX/KaTeX) | 0.19.0 | katex/katex.min.js, auto-render.min.js, CSS and fonts | katex/LICENSE (MIT) |

The new bundles are unmodified files from the official npm distributions:
`markdown-it/dist/browser/markdown-it.umd.min.js`, `dompurify/dist/purify.min.js`,
and `katex/dist/katex.min.js`, `contrib/auto-render.min.js`, `katex.min.css`, and `fonts/`. The markdown-it
bundle is renamed locally. js-yaml comes from its upstream 4.1.1 Git tag.

To update, download a pinned release into a temporary directory, review its
upstream changes and license, copy the browser distribution and license, update
this inventory, and run the Node and browser authoring checks. Bump the editor's
asset query version so an older cached module is not mixed with the update.

WenKai bundles only the `lxgwwenkaiscreen.css` font family and its referenced files
from `lxgw-wenkai-screen-webfont@1.7.0`. Other variant families are omitted. The
browser downloads only the Unicode subsets needed for visible text. Editor fonts
stay on the same origin; no font CDN or additional script origin is required.
