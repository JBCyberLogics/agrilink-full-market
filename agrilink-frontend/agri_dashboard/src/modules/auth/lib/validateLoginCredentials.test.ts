import { describe, expect, it } from 'vitest';
import { validateLoginCredentials } from './validateLoginCredentials';

describe('validateLoginCredentials', () => {
  it('requires a non-empty email or username and password', () => {
    expect(validateLoginCredentials({ identity: '', password: '' })).toEqual({
      identity: 'Enter your email or username.',
      password: 'Enter your password.',
    });
    expect(validateLoginCredentials({ identity: '   ', password: 'secret' })).toEqual({
      identity: 'Enter your email or username.',
    });
    expect(validateLoginCredentials({ identity: 'operator@example.test', password: '' })).toEqual({
      password: 'Enter your password.',
    });
  });

  it('does not claim to check whether credentials are valid', () => {
    expect(validateLoginCredentials({ identity: 'operator@example.test', password: 'any value' })).toEqual({});
  });
});
