# Third-party notices

Syncode includes the components and assets listed below. Keep this file and
the applicable license text with redistributed copies.

## Adapted code and icons

**Microsoft VS Code.** Syncode's commit-history interface includes code
adapted from VS Code's source-control history implementation.

- https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/scm/browser/scmHistory.ts
- https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/scm/browser/scmHistoryViewPane.ts

Copyright Microsoft Corporation. Licensed under the MIT License.

**Codicons.** The interface uses Codicons from the Visual Studio Code icon set,
provided through Iconify. Copyright Microsoft Corporation. The icons are used
without modification under CC BY 4.0:
https://creativecommons.org/licenses/by/4.0/

Source: https://github.com/microsoft/vscode-codicons

**VSCode file icons.** `src/components/editor/vscodeFileIcons.json` includes
file and folder icons from vscode-icons. Copyright the vscode-icons
Contributors. Licensed under the MIT License:
https://github.com/vscode-icons/vscode-icons/blob/master/LICENSE

**Ionicons.** The send icon is from Ionicons via `react-icons`. Copyright
2015-present Ionic. Licensed under the MIT License:
https://github.com/ionic-team/ionicons/blob/main/LICENSE

## Client production dependencies

Versions are from `package-lock.json`. Transitive production dependencies are
included; development and test dependencies are not.

| License | Packages |
| --- | --- |
| MIT | `@iconify/react` 6.0.2; `@iconify/types` 2.0.0; `@microsoft/signalr` 10.0.11; `@monaco-editor/loader` 1.7.0; `@monaco-editor/react` 4.7.0; `@types/trusted-types` 2.0.7; `@xterm/addon-fit` 0.11.0; `@xterm/xterm` 6.0.0; `abort-controller` 3.0.0; `cookie` 1.1.1; `event-target-shim` 5.0.1; `eventsource` 2.0.2; `fflate` 0.8.3; `marked` 14.0.0; `monaco-editor` 0.57.0; `node-fetch` 2.7.0; `psl` 1.15.0; `punycode` 2.3.1; `querystringify` 2.2.0; `react` 19.2.8; `react-dom` 19.2.8; `react-icons` 5.7.0; `react-router` 7.18.4; `react-router-dom` 7.18.4; `requires-port` 1.0.0; `scheduler` 0.27.0; `set-cookie-parser` 2.7.2; `state-local` 1.0.7; `tr46` 0.0.3; `universalify` 0.2.0; `url-parse` 1.5.10; `uuid` 14.0.2; `vscode-ws-jsonrpc` 4.0.3; `vscode-jsonrpc` 9.0.3; `whatwg-url` 5.0.0; `ws` 7.5.13 |
| BSD-2-Clause | `webidl-conversions` 3.0.1 |
| BSD-3-Clause | `tough-cookie` 4.1.4 |
| Unlicense | `fetch-cookie` 2.2.0 |
| MPL-2.0 or Apache-2.0 | `dompurify` 3.4.17 |

Copyright and license details:

- `webidl-conversions`: Copyright (c) 2014 Domenic Denicola.  
  https://github.com/jsdom/webidl-conversions/blob/master/LICENSE.md
- `tough-cookie`: Copyright (c) 2015 Salesforce.com, Inc.  
  https://github.com/salesforce/tough-cookie/blob/master/LICENSE
- `fetch-cookie`: Copyright Valerian Galliat.  
  https://github.com/valeriangalliat/fetch-cookie/blob/master/UNLICENSE
- `dompurify`: Copyright 2015-present Cure53 and contributors.  
  https://github.com/cure53/DOMPurify/blob/main/LICENSE  
  https://github.com/cure53/DOMPurify/blob/main/LICENSE-MPL

## Server production dependencies

Resolved for the server's `net10.0` target. All packages below use the MIT
License.

| Package | Version | Copyright |
| --- | --- | --- |
| `Microsoft.AspNetCore.OpenApi` | 10.0.13 | Microsoft Corporation |
| `Microsoft.AspNetCore.SignalR.StackExchangeRedis` | 10.0.13 | Microsoft Corporation |
| `StackExchange.Redis` | 3.3.0 | Stack Exchange, Inc. |
| `MessagePack` and `MessagePack.Annotations` | 2.5.303 | Yoshifumi Kawai and contributors |
| `Microsoft.NET.StringTools` | 17.6.3 | Microsoft Corporation |
| `Microsoft.OpenApi` | 2.12.2 | Microsoft Corporation |
| `RESPite` | 3.3.0 | Marc Gravell |
| `System.IO.Hashing` | 10.0.12 | Microsoft Corporation |

Sources and license information:

- https://github.com/dotnet/aspnetcore
- https://github.com/StackExchange/StackExchange.Redis
- https://github.com/MessagePack-CSharp/MessagePack-CSharp
- https://github.com/mgravell/RESPite
- https://github.com/dotnet/runtime

## License texts

### MIT License

Standard permission and warranty text for components marked MIT. This does
not replace each component's own copyright notice; retain the copyright and
license files shipped with each package when redistributing it.

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

### BSD licenses

`webidl-conversions` is distributed under the BSD 2-Clause License.

Copyright (c) 2014, Domenic Denicola. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDER "AS IS" AND ANY EXPRESS OR
IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO
EVENT SHALL THE COPYRIGHT HOLDER BE LIABLE FOR ANY DIRECT, INDIRECT,
INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA,
OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

`tough-cookie` is distributed under the BSD 3-Clause License.

Copyright (c) 2015, Salesforce.com, Inc. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of Salesforce.com nor the names of its contributors may
   be used to endorse or promote products derived from this software without
   specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDER "AS IS" AND ANY EXPRESS OR
IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO
EVENT SHALL THE COPYRIGHT HOLDER BE LIABLE FOR ANY DIRECT, INDIRECT,
INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA,
OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

### Other license texts

- Codicons: CC BY 4.0, https://creativecommons.org/licenses/by/4.0/
- DOMPurify: MPL-2.0 or Apache-2.0; see the linked license texts above.
- `fetch-cookie`: Unlicense; see the linked text above.
