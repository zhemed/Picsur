## node-gyp 候选
node-gyp@11       node-gyp@11.0.0 version = '11.0.0'node-gyp@11.0.0 engines = { node: '^18.17.0 || >=20.5.0' }node-gyp@11.1.0 version = '1
node-gyp@12       node-gyp@12.0.0 version = '12.0.0'node-gyp@12.0.0 engines = { node: '^20.17.0 || >=22.9.0' }node-gyp@12.1.0 version = '1
node-gyp@13       node-gyp@13.0.0 version = '13.0.0'node-gyp@13.0.0 engines = { node: '^22.22.2 || ^24.15.0 || >=26.0.0' }node-gyp@13.0.1 
node-gyp@latest   version = '13.1.0'engines = { node: '^22.22.2 || ^24.15.0 || >=26.0.0' }

## node-gyp@11 依赖（看 tar/glob/minimatch/brace-expansion）
node-gyp@11.0.0 {  tar: '^7.4.3',  glob: '^10.3.10',  nopt: '^8.0.0',  which: '^5.0.0',  semver: '^7.3.5',  'proc-log': '^5.0.0',  'env-paths': '^2.2.0',  'graceful-fs': '^4.2.6',  'make-fetch-happen': '^14.0.3',  'exponential-backoff': '^3.1.1'}node-gyp@11.1.0 {  tar: '^7.4.3',  glob: '^10.3.10',  nopt: '^8.0.0',  which: '^5.0.0',  semver: '^7.3.5',  'proc-log': '^5.0.0',  'env-paths': '^2.2.0',  'graceful-fs': '^4.2.6',  'make-fetch-happen': '^14.0.3',  'exponential-backoff': '^3.1.1'}node-gyp

## 运行时三项
fast-uri               latest=4.2.2
jws                    latest=4.0.1
lodash                 latest=4.18.1
jsonwebtoken           latest=9.0.3
passport-jwt           latest=4.0.1
passport-headerapikey  latest=1.2.2

## jsonwebtoken 各线 jws 依赖
jsonwebtoken@9.0.2 -> ^3.2.2
jsonwebtoken@9.0.3 -> ^4.0.1

## passport-jwt 依赖
{ jsonwebtoken: '^9.0.0', 'passport-strategy': '^1.0.0' }
