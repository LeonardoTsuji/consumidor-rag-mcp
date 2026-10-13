export class AppError extends Error {
  constructor(public code:string, message:string, public statusCode=500) { super(message); }
}
export function providerError(error:unknown):AppError {
  if (error instanceof AppError) return error;
  const e = error as {status?:number;statusCode?:number;name?:string};
  const status = e?.status ?? e?.statusCode;
  if (status === 401 || status === 403) return new AppError('PROVIDER_AUTH','A chave Gemini foi recusada.',502);
  if (status === 429) return new AppError('PROVIDER_QUOTA','Quota do Gemini excedida. Tente novamente mais tarde.',429);
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError' || status === 408 || status === 504) return new AppError('PROVIDER_TIMEOUT','O Gemini excedeu o tempo de resposta.',504);
  if (status === 503) return new AppError('PROVIDER_UNAVAILABLE','O Gemini está temporariamente indisponível ou com alta demanda. Tente novamente em instantes.',502);
  return new AppError('PROVIDER_UNAVAILABLE','O Gemini está indisponível ou retornou uma resposta inválida.',502);
}
