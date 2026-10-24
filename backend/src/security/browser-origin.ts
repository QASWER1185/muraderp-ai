import type { Request } from 'express';
import { ApiError } from '../errors/api-error.js';
import { env } from '../config/env.js';
/** Vercel rewrites preserve Origin but replace Host. Accept only the public
 * frontend's configured origin; a caller-controlled forwarded host is insufficient. */
export function assertBrowserSameOrigin(request: Request): void {
  const origin=request.header('Origin'), site=request.header('Sec-Fetch-Site');
  if(site==='cross-site')throw new ApiError(403,'FORBIDDEN','Same-origin request required');
  if(!origin)return;
  let url:URL;try{url=new URL(origin);}catch{throw new ApiError(403,'FORBIDDEN','Invalid request origin');}
  const allowed=new Set(['https://muraderp-ai.vercel.app']);
  if(url.origin===`${request.protocol}://${request.get('host')}`||allowed.has(url.origin))return;
  if(env.NODE_ENV!=='production'&&url.host===request.get('host'))return;
  throw new ApiError(403,'FORBIDDEN','Same-origin request required');
}
