# Bundled browser libraries

These assets are served locally so the authoring page loads no third-party scripts.
No npm dependencies or package manager are required in the Hugo repository.

| Library | Version | Bundled asset | License |
| --- | --- | --- | --- |
| [js-yaml](https://github.com/nodeca/js-yaml) | 4.1.1 | js-yaml.min.js | LICENSE.js-yaml (MIT) |
| [markdown-it](https://github.com/markdown-it/markdown-it) | 15.0.3 | markdown-it.min.js | LICENSE.markdown-it (MIT) |
| [DOMPurify](https://github.com/cure53/DOMPurify) | 3.4.17 | purify.min.js | LICENSE.dompurify (Apache-2.0 option) |
| [KaTeX](https://github.com/KaTeX/KaTeX) | 0.19.0 | katex/katex.min.js, CSS and fonts | katex/LICENSE (MIT) |

The new bundles are unmodified files from the official npm distributions:
`markdown-it/dist/browser/markdown-it.umd.min.js`, `dompurify/dist/purify.min.js`,
and `katex/dist/katex.min.js`, `katex.min.css`, and `fonts/`. The markdown-it
bundle is renamed locally. js-yaml comes from its upstream 4.1.1 Git tag.

To update, download a pinned release into a temporary directory, review its
upstream changes and license, copy the browser distribution and license, update
this inventory, and run the Node and browser authoring checks. Bump the editor's
asset query version so an older cached module is not mixed with the update.
