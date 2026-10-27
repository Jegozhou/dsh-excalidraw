# Third-party notices

This project's original code is MIT-licensed (see [LICENSE](LICENSE)). It bundles or redistributes the following third-party work. The notices are provided to satisfy the attribution requirements of those licenses.

## 1. Excalidraw renderer and dependencies

The browser half bundles **`@excalidraw/excalidraw@0.18.1`** (MIT) and its browser dependency closure. The Excalidraw copyright and permission notice:

```
MIT License

Copyright (c) 2020 Excalidraw

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The bundled closure (127 packages by production esbuild metafile) is mostly MIT, ISC, Apache-2.0, BSD-3-Clause, 0BSD, Unlicense and CC0-1.0. The complete generated inventory, including the two metadata gaps (`khroma` omits its MIT field; `fuzzy@0.1.3` declares MIT but has no repository license file), is in [docs/evidence/license-inventory.md](docs/evidence/license-inventory.md).

React and React DOM are **not redistributed** by this plugin: the client bundle keeps them external so the Harness page supplies its own React 18.3.1. React is MIT-licensed (Copyright (c) Meta Platforms, Inc. and affiliates).

## 2. Fonts

The font files under `assets/fonts/` are copied unmodified from the `@excalidraw/excalidraw@0.18.1` npm distribution. The metadata below was read from the embedded name tables of the shipped files (family, copyright, designer, license, license URL). The Excalifont entry also uses the license block in Excalidraw's `packages/excalidraw/fonts/Excalifont/index.ts`.

| Family | Copyright (embedded name table) | Designer | License |
|---|---|---|---|
| Assistant | Copyright 2020 The Assistant Project Authors; Copyright 2010 The Source Sans Pro Authors (Reserved Font Name 'Source') | Hebrew by Ben Nathan, Latin by Paul Hunt | SIL OFL 1.1 |
| Cascadia Code | © 2020 Microsoft Corporation. All Rights Reserved. | Aaron Bell | Name table says "Microsoft supplied font" with licenseURL <https://scripts.sil.org/OFL> — see caveat below |
| Comic Shanns | MIT License; Copyright (c) 2018 Shannon Miwa; 2023 Jesus Gonzalez, Rodrigo Batista de Moraes; 2024 Fini Jastrow, Kyle Beechly | — | MIT |
| Excalifont | Copyright (c) 2024 by Excalidraw. All rights reserved. | Your Own Font Foundry (Virgil); Ján Filípek / DizajnDesign (Excalifont, modifications) | SIL OFL 1.1 |
| Liberation Sans | Copyright 2007 Ascender Corporation. All rights reserved. | Steve Matteson | Name table says use is subject to the Ascender license agreement; licenseURL <http://www.ascendercorp.com/liberation.html> — see caveat below |
| Lilita One | Copyright (c) 2011 Juan Montoreano, with Reserved Font Name "Lilita One" | Juan Montoreano | SIL OFL 1.1 (licenseURL scripts.sil.org/OFL) |
| Nunito | Copyright 2014 The Nunito Project Authors (https://github.com/googlefonts/nunito) | — | SIL OFL 1.1 (licenseURL scripts.sil.org/OFL) |
| Virgil | Copyright (c) 2011 by Your Own Font Foundry. All rights reserved. | Your Own Font Foundry | SIL OFL 1.1 |
| Xiaolai SC | Copyright © 2020 LXGW | Nozomi Seto 瀬戸ののぞみ | SIL OFL 1.1 |

**Cascadia Code / Liberation Sans caveat.** These two files are redistributed exactly as they appear in the MIT-licensed Excalidraw npm package, which is how Excalidraw itself ships them. Their name tables carry vendor-specific terms alongside an OFL URL, so this project records rather than reinterprets them. If a downstream distributor needs an unambiguous font policy, remove those two directories from `assets/fonts/` and keep the rest; Excalidraw falls back to the available families in the CSS stack.

### SIL Open Font License 1.1

```
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded, 
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

## 3. Upstream Obsidian Excalidraw plugin

No source code from `zsviczian/obsidian-excalidraw-plugin` is included or linked into this project. The repository is used only as a behavioral reference, with short quotations and file:line citations in [docs/01-upstream-evidence.md](docs/01-upstream-evidence.md). Its `LICENSE` is AGPL-3.0 while its `package.json` says MIT; that unresolved contradiction is documented in [docs/06-license-audit.md](docs/06-license-audit.md) and is deliberately not inherited by this original implementation.

## 4. Test fixtures

The drawings under `fixtures/upstream/` were generated by this project with the MIT `@zsviczian/excalidraw@0.18.145` runtime (the same serializer the Obsidian plugin embeds). They are not copied from the AGPL repository; provenance, generation method and checksums are recorded in [fixtures/upstream/manifest.json](fixtures/upstream/manifest.json).

## 5. Build tools

esbuild (MIT), TypeScript (Apache-2.0), Playwright (Apache-2.0) and pnpm (MIT) are development-time tools and are not redistributed in the plugin package.
