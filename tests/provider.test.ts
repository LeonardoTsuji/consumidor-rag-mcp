import { describe,it,expect,vi,afterEach } from 'vitest';
import { withProviderRetry } from '../apps/api/src/gemini.js';
import { providerError } from '../apps/api/src/errors.js';

afterEach(()=>vi.useRealTimers());
describe('falhas transitórias do Gemini',()=>{
  it.each([500,502,503])('recupera após falha HTTP %s',async status=>{
    vi.useFakeTimers();
    const operation=vi.fn().mockRejectedValueOnce({status}).mockResolvedValue('resposta');
    const pending=withProviderRetry(operation);
    await vi.advanceTimersByTimeAsync(499);
    expect(operation).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe('resposta');
    expect(operation).toHaveBeenCalledTimes(2);
  });
  it('limita tentativas quando a alta demanda persiste',async()=>{
    vi.useFakeTimers();
    const error={status:503};
    const operation=vi.fn().mockRejectedValue(error);
    const pending=expect(withProviderRetry(operation)).rejects.toBe(error);
    await vi.advanceTimersByTimeAsync(1500);
    await pending;
    expect(operation).toHaveBeenCalledTimes(3);
    expect(providerError(error).message).toContain('alta demanda');
  });
  it.each([{status:401},{status:403},{status:429},{name:'AbortError'},new SyntaxError('JSON inválido')])('não repete falha permanente ou timeout %j',async error=>{
    const operation=vi.fn().mockRejectedValue(error);
    await expect(withProviderRetry(operation)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
