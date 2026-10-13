## nest 11 家族
@nestjs/core                 12.1.3
@nestjs/common               12.1.3
@nestjs/platform-fastify     12.1.3
@nestjs/config               12.0.1
@nestjs/typeorm              12.0.2
@nestjs/jwt                  12.0.3
@nestjs/passport             12.0.0
@nestjs/schedule             12.0.2
@nestjs/serve-static         12.0.0
@nestjs/throttler            6.7.1

## @nestjs/platform-fastify@11 依赖
@nestjs/platform-fastify@11.0.0 dependencies = {
  tslib: '2.8.1',
  fastify: '5.2.1',
  '@fastify/cors': '10.0.2',
  'path-to-regexp': '8.2.0',
  '@fastify/middie': '9.0.3',
  'light-my-request': '6.5.1',
  '@fastify/formbody': '8.0.2'
}
@nestjs/platform-fastify@11.0.0 peerDependencies = {
  '@nestjs/core': '^10.0.0',
  '@fastify/view': '^10.0.0',
  '@nestjs/common': '^10.0.0',
  '@fastify/static': '^8.0.0'
}
@nestjs/platform-fastify@11.0.1 dependencies = {
  tslib: '2.8.1',
  fastify: '5.2.1',
  '@fastify/cors': '10.0.2',
  'path-to-regexp': '8.2.0',

## fastify 5 家族 latest + peer
fastify                    latest=5.12.5     peer/fastify=@fastify/helmet            latest=13.1.2     peer/fastify=@fastify/multipart         latest=10.1.3     peer/fastify=@fastify/reply-from        latest=12.7.1     peer/fastify=@fastify/static            latest=10.1.6     peer/fastify=
## 其它直接依赖
typeorm        latest=1.1.2
sharp          latest=0.35.5
file-type      latest=22.1.1
zod            latest=4.6.7
pg             latest=8.23.1
bcrypt-ts      latest=9.0.2
ms             latest=2.1.3
semver         latest=7.8.5

## @nestjs/platform-fastify@12 依赖/peer
dependencies = {
  tslib: '2.8.1',
  fastify: '5.12.5',
  'find-my-way': '9.9.0',
  '@fastify/cors': '11.3.1',
  'path-to-regexp': '8.4.2',
  '@fastify/middie': '9.3.5',
  'fast-querystring': '1.1.2',
  'light-my-request': '6.6.0',
  '@fastify/formbody': '9.0.1'
}
peerDependencies = {
  '@nestjs/core': '^12.0.0',
  '@fastify/view': '^10.0.0 || ^11.0.0 || ^12.0.0',
  '@nestjs/common': '^12.0.0',
  '@fastify/static': '^10.1.2',
  '@fastify/multipart': '^10.1.0'
}

## @nestjs/core@12 engines/peer
{ node: '>= 20' }
## @nestjs/typeorm@12 peer
{
  rxjs: '^7.2.0',
  typeorm: '^0.3.0 || ^1.0.0-dev',
  '@nestjs/core': '^10.0.0 || ^11.0.0 || ^12.0.0',
  '@nestjs/common': '^10.0.0 || ^11.0.0 || ^12.0.0',
  'reflect-metadata': '^0.1.13 || ^0.2.0'
}
## @nestjs/config@12 peer
{ rxjs: '^7.1.0', '@nestjs/common': '^11.0.0 || ^12.0.0' }
## @nestjs/throttler@6.7.1 peer
{
  '@nestjs/core': '^7.0.0 || ^8.0.0 || ^9.0.0 || ^10.0.0 || ^11.0.0 || ^12.0.0',
  '@nestjs/common': '^7.0.0 || ^8.0.0 || ^9.0.0 || ^10.0.0 || ^11.0.0 || ^12.0.0',
  'reflect-metadata': '^0.1.13 || ^0.2.0'
}
## @nestjs/serve-static@12 peer
{
  express: '^5.0.1',
  fastify: '^5.2.1',
  '@nestjs/core': '^12.0.0',
  '@nestjs/common': '^12.0.0',
  '@fastify/static': '^10.0.0'
}
## @fastify/* peer
@fastify/helmet@13.1.2         
@fastify/multipart@10.1.3      
@fastify/reply-from@12.7.1     
@fastify/static@10.1.6         

## typeorm 0.3.x 最新补丁线
0.3.29-dev.514e3d8
0.3.29-dev.6e34756
0.3.29-dev.73fda41
0.3.29-dev.a46eb0a
0.3.29-dev.cc07c90
0.3.29
0.3.30
0.3.31
## typeorm 0.3.29 engines
engines = { node: '>=16.13.0' }
peerDependencies = {
  pg: '^8.5.1',
  mssql: '^9.1.1 || ^10.0.0 || ^11.0.0 || ^12.0.0',
  redis: '^3.1.1 || ^4.0.0 || ^5.0.14',
  mysql2: '^2.2.5 || ^3.0.1',
  'sql.js': '^1.4.0',
  ioredis: '^5.0.4',
  mongodb: '^5.8.0 || ^6.0.0',
  sqlite3: '^5.0.3',
  'ts-node': '^10.7.0',
  oracledb: '^6.3.0',
  'pg-native': '^3.0.0',
  'better-sqlite3': '^8.0.0 || ^9.0.0 || ^10.0.0 || ^11.0.0 || ^12.0.0',
  'pg-query-stream': '^4.0.0',
  '@sap/hana-client': '^2.14.22',
  '@google-cloud/spanner': '^5.18.0 || ^6.0.0 || ^7.0.0 || ^8.0.0',
  'typeorm-aurora-data-api-driver': '^2.0.0 || ^3.0.0'
}
## sharp 0.35.5 engines + libvips 要求
{ node: '>=20.9.0' }
{ semver: '^7.8.5', '@img/colour': '^1.1.0', 'detect-libc': '^2.1.2' }

## sharp 0.35.5 要求的全局 libvips
{ libvips: '>=8.18.7' }
## sharp 0.33.5 对比
{ libvips: '>=8.15.3' }

## @nestjs/cli 与 schematics latest
12.0.8
12.0.7

## pass/fail: 前端是否也会被牵动（shared 的 zod 是否被 frontend 直接引用）
frontend/package.json:55:    "picsur-shared": "workspace:^",
frontend/package.json:63:    "zod": "^3.23.8",
shared/package.json:2:  "name": "picsur-shared",
shared/package.json:17:    "zod": "^3.23.8"
backend/package.json:54:    "picsur-shared": "workspace:^",
backend/package.json:64:    "zod": "^3.23.8"

## 预计的传递依赖（残留告警候选）
fastify@5.12.5 deps: {  pino: '^9.14.0 || ^10.1.0',  rfdc: '^1.3.1',  avvio: '^9.0.0',  semver: '^7.6.0',  'toad-cache': '^3.7.0',  'find-my-way': '^9.6.0',  '@fastify/error': '^4.0.0',  'process-warning': '^5.1.0',  'abstract-logging': '^2.0.1',  'light-my-request': '^6.0.0',  'secure-json-parse': '^4.0.0',  '@fastify/proxy-addr': '^5.0.0',  'fast-json-stringify': '^7.0.0',  '@fastify/ajv-compiler': '^4.0.5',  '@fastify/fast-json-stringify-compiler': '^5.0.0'}

@nestjs/jwt@12.0.3 deps: { jsonwebtoken: '9.0.3', '@types/jsonwebtoken': '9.0.10' }
jsonwebtoken@latest deps: {  ms: '^2.1.1',  jws: '^4.0.1',  semver: '^7.5.4',  'lodash.once': '^4.0.0',  'lodash.includes': '^4.3.0',  'lodash.isnumber': '^3.0.3',  'lodash.isstring': '^4.0.1',  'lodash.isboolean': '^3.0.3',  'lodash.isinteger': '^4.0.4',  'lodash.isplainobject': '^4.0.6'}
@fastify/static@10.1.6 deps: {  glob: '^13.0.0',  fastq: '^1.17.1',  '@fastify/send': '^4.0.0',  '@fastify/error': '^4.0.0',  'fastify-plugin': '^6.0.0',  'content-disposition': '^3.0.0',  '@fastify/accept-negotiator': '^2.0.0'}
@fastify/multipart@10.1.3 deps: {  '@fastify/error': '^4.0.0',  'fastify-plugin': '^6.0.0',  '@fastify/busboy': '^3.0.0',  'secure-json-parse': '^4.0.0',  '@fastify/deepmerge': '^3.0.0'}
@fastify/helmet@13.1.2 deps: { helmet: '^8.0.0', 'fastify-plugin': '^6.0.0' }

file-type@22.1.1 engines: { node: '>=22' }
typeorm@0.3.31 deps: {  glob: '^10.5.0',  uuid: '^11.1.1',  ansis: '^4.3.1',  dayjs: '^1.11.21',  debug: '^4.4.3',  tslib: '^2.8.1',  yargs: '^17.7.3',  buffer: '^6.0.3',  dedent: '^1.7.2',  dotenv: '^16.6.1',  'sha.js': '^2.4.12',  'app-root-path': '^3.1.0',  'sql-highlight': '^6.1.0',  'reflect-metadata': '^0.2.2',  '@sqltools/formatter': '^1.2.5'}
## engines 复核（必须兼容 Node 20）
file-type@21.3.1                       { node: '>=20' }
file-type@21                           file-type@21.0.0 { node: '>=20' }file-type@21.1.0 { node: '>
fastify@5.12.5                         
@fastify/static@10.1.6                 
@fastify/multipart@10.1.3              
@fastify/helmet@13.1.2                 
@fastify/reply-from@12.7.1             
@nestjs/core@12.1.3                    { node: '>= 20' }
@nestjs/platform-fastify@12.1.3        
sharp@0.35.5                           { node: '>=20.9.0' }
typeorm@0.3.31                         { node: '>=16.13.0' }

## file-type 21 线可用版本
21.3.0
21.3.1
21.3.2
21.3.3
21.3.4
