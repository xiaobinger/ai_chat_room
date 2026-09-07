import { describe, expect, it } from 'vitest';
import { parseRedisConnection, requireRedisConnection } from '../redis-connection';

describe('parseRedisConnection', () => {
  it('keeps host and default port', () => {
    expect(parseRedisConnection('redis://localhost')).toEqual({ host: 'localhost', port: 6379 });
    expect(parseRedisConnection('redis://192.168.10.204:6379')).toEqual({
      host: '192.168.10.204',
      port: 6379,
    });
  });

  it('preserves credentials and db index, which the old split-based parser dropped', () => {
    expect(parseRedisConnection('redis://queue_user:s3cr3t@db.internal:6380/3')).toEqual({
      host: 'db.internal',
      port: 6380,
      username: 'queue_user',
      password: 's3cr3t',
      db: 3,
    });
  });

  it('decodes percent-encoded passwords instead of feeding NaN to parseInt', () => {
    expect(parseRedisConnection('redis://:p%40ss%25word@host:6379').password).toBe('p@ss%word');
  });

  it('accepts a password-only URL', () => {
    expect(parseRedisConnection('redis://:onlypass@host:6379')).toEqual({
      host: 'host',
      port: 6379,
      password: 'onlypass',
    });
  });

  it('turns rediss:// into TLS options', () => {
    expect(parseRedisConnection('rediss://host:6379')).toEqual({
      host: 'host',
      port: 6379,
      tls: {},
    });
  });

  it('rejects anything that is not a redis URL', () => {
    expect(() => parseRedisConnection('redis://user:hunter2@host:6379')).not.toThrow();
    expect(() => parseRedisConnection('not a url')).toThrow(/invalid_redis_url/);
    expect(() => parseRedisConnection('mysql://host:3306')).toThrow(/^unsupported_redis_scheme: mysql$/);
  });

  it('redacts credentials out of the parse-failure message', () => {
    // 含空格所以 new URL 解析失败，同时带着真实密码 —— 报错信息绝不能原样回显
    let message = '';
    try {
      parseRedisConnection('redis://user:hunter2@bad host:6379');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/^invalid_redis_url: redis:\/\/\*\*\*@bad host:6379$/);
    expect(message).not.toContain('hunter2');
  });

  it('rejects a non-numeric db segment instead of silently ignoring it', () => {
    expect(() => parseRedisConnection('redis://host:6379/latest')).toThrow(/invalid_redis_db/);
  });

  it('omits db when the path is empty', () => {
    expect(parseRedisConnection('redis://host:6379/')).not.toHaveProperty('db');
    expect(parseRedisConnection('redis://host:6379/0')).toEqual({ host: 'host', port: 6379, db: 0 });
  });
});

describe('requireRedisConnection', () => {
  it('fails loudly instead of treating "unset" as "not needed"', () => {
    expect(() => requireRedisConnection({})).toThrow('redis_url_not_configured');
    expect(() => requireRedisConnection({ REDIS_URL: '   ' })).toThrow('redis_url_not_configured');
  });

  it('parses the configured URL', () => {
    expect(requireRedisConnection({ REDIS_URL: 'redis://127.0.0.1:6390/1' })).toEqual({
      host: '127.0.0.1',
      port: 6390,
      db: 1,
    });
  });
});
