/*
 * ShareX 自定义上传器的配置样例（字段含义见 ShareX 文档）。
 * 真正导出的配置由下面的 BuildShareX() 用**当前实例**的 host 与登录用户的 API key 拼出来，
 * 所以这里不写任何具体域名 —— 曾经这里写着一台上游开发机的临时 ngrok 隧道地址，
 * 既会泄漏别人的主机、也会让人以为要填那个域名（2026-10-15 清理）。
 *
 * 下面的形状与 BuildShareX() 的产物一致，仅把值换成占位符：
 * {
 *   "Version": "14.1.0",
 *   "Name": "Picsur",
 *   "DestinationType": "ImageUploader",
 *   "RequestMethod": "POST",
 *   "RequestURL": "https://<你的实例>/api/image/upload",
 *   "Headers": { "Authorization": "Api-Key <API key>" },
 *   "Body": "MultipartFormData",
 *   "FileFormName": "image",
 *   "URL": "https://<你的实例>/i/{json:data.id}.png",
 *   "ThumbnailURL": "https://<你的实例>/i/{json:data.id}.jpg?width=128&shrinkonly=yes",
 *   "DeletionURL": "https://<你的实例>/api/image/delete/{json:data.id}/{json:data.delete_key}",
 *   "ErrorMessage": "{json:data.message}"
 * }
 */

export interface ShareXObject {
  Version: string;
  Name: string;
  DestinationType: string;
  RequestMethod: string;
  RequestURL: string;
  Headers: {
    Authorization: string;
  };
  Body: string;
  FileFormName: string;
  URL: string;
  ThumbnailURL: string;
  DeletionURL?: string;
  ErrorMessage: string;
}

export function BuildShareX(
  host: string,
  apikey: string,
  preferredExt: string,
  canDelete: boolean,
): ShareXObject {
  const base: ShareXObject = {
    Version: '14.1.0',
    Name: 'Picsur',
    DestinationType: 'ImageUploader',
    RequestMethod: 'POST',
    RequestURL: `${host}/api/image/upload`,
    Headers: {
      Authorization: `Api-Key ${apikey}`,
    },
    Body: 'MultipartFormData',
    FileFormName: 'image',
    URL: `${host}/i/{json:data.id}${preferredExt}`,
    ThumbnailURL: `${host}/i/{json:data.id}.jpg?width=128&shrinkonly=yes`,
    ErrorMessage: '{json:data.message}',
  };

  if (canDelete) {
    base.DeletionURL = `${host}/api/image/delete/{json:data.id}/{json:data.delete_key}`;
  }

  return base;
}
