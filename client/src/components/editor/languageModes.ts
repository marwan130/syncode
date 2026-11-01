export type LanguageMode =
  | 'plaintext'
  | 'markdown'
  | 'mdx'
  | 'json'
  | 'yaml'
  | 'xml'
  | 'dockerfile'
  | 'ini'
  | 'shell'
  | 'powershell'
  | 'bat'
  | 'sql'
  | 'go'
  | 'ruby'
  | 'php'
  | 'kotlin'
  | 'swift'
  | 'dart'
  | 'graphql'
  | 'protobuf'
  | 'hcl'
  | 'lua'
  | 'r'
  | 'scala'
  | 'perl'
  | 'cpp'
  | 'html'
  | 'css'
  | 'javascript'
  | 'typescript'
  | 'python'
  | 'csharp'
  | 'c'
  | 'rust'
  | 'java';

export type PreviewLanguage = 'html' | 'css' | 'javascript' | 'typescript';

export function isPreviewLanguage(
  language: LanguageMode
): language is PreviewLanguage {
  return (
    language === 'html' ||
    language === 'css' ||
    language === 'javascript' ||
    language === 'typescript'
  );
}

const EXTENSION_LANGUAGES: Record<string, LanguageMode> = {
  txt: 'plaintext',
  log: 'plaintext',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'mdx',
  json: 'json',
  jsonc: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  xml: 'xml',
  svg: 'xml',
  xsd: 'xml',
  xsl: 'xml',
  xslt: 'xml',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  ps1: 'powershell',
  psm1: 'powershell',
  bat: 'bat',
  cmd: 'bat',
  sql: 'sql',
  go: 'go',
  rb: 'ruby',
  rake: 'ruby',
  gemspec: 'ruby',
  php: 'php',
  phtml: 'php',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  dart: 'dart',
  graphql: 'graphql',
  gql: 'graphql',
  proto: 'protobuf',
  hcl: 'hcl',
  tf: 'hcl',
  lua: 'lua',
  r: 'r',
  scala: 'scala',
  pl: 'perl',
  pm: 'perl',
  dockerfile: 'dockerfile',
  ini: 'ini',
  conf: 'ini',
  cfg: 'ini',
  toml: 'ini',
  properties: 'ini',
  env: 'ini',
  editorconfig: 'ini',
  py: 'python',
  pyw: 'python',
  html: 'html',
  htm: 'html',
  css: 'css',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescript',
  jsx: 'javascript',
  cs: 'csharp',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  rs: 'rust',
  java: 'java',
};

export function languageForFileName(name: string): LanguageMode {
  const fileName = name.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  const extension = fileName.split('.').pop() ?? '';
  if (fileName === 'dockerfile' || fileName.startsWith('dockerfile.'))
    return 'dockerfile';
  return EXTENSION_LANGUAGES[extension] ?? 'plaintext';
}
