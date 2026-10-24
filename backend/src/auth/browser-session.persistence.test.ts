import express from 'express';
import request from 'supertest';
import {describe,it,expect,vi,afterEach} from 'vitest';
import {issueBrowserSession} from './browser-session.js';
import {authRouter} from '../routes/auth.routes.js';
afterEach(()=>vi.useRealTimers());
describe('persistent browser session',()=>{
 it('survives reload after an overnight pause, renews securely, and expires after inactivity',async()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-24T00:00:00Z'));
  const app=express();app.get('/fixture',(_req,res)=>{issueBrowserSession('11111111-1111-4111-8111-111111111111',res);res.end();});app.use('/auth',authRouter);
  const issued=await request(app).get('/fixture');const rawCookie=(issued.headers['set-cookie'] as unknown as string[])[0]!;const cookie=rawCookie.split(';')[0]!;
  expect(rawCookie).toMatch(/HttpOnly/);expect(rawCookie).toMatch(/SameSite=Lax/);expect(rawCookie).toMatch(/Max-Age=604800/);
  vi.setSystemTime(new Date('2026-10-25T08:00:00Z'));const restored=await request(app).get('/auth/session').set('Cookie',cookie);
  expect(restored.status).toBe(200);expect(restored.headers['cache-control']).toContain('no-store');expect(restored.headers['set-cookie']).toHaveLength(1);
  vi.setSystemTime(new Date('2026-11-02T08:00:00Z'));expect((await request(app).get('/auth/session').set('Cookie',cookie)).status).toBe(401);
 });
});
