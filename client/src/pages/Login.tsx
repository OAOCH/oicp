import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

const ERRORS: Record<string, string> = {
  invalid: 'El enlace no es válido o ya expiró. Solicita uno nuevo.',
  revoked: 'Tu acceso fue revocado. Contacta al administrador.',
  disabled: 'El acceso por correo aún no está habilitado.',
  error: 'Ocurrió un error procesando el enlace. Intenta de nuevo.',
};

export default function Login() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [params] = useSearchParams();
  const linkError = params.get('e');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setMessage('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus('sent');
        setMessage(data.message || 'Te enviamos un enlace de acceso a tu correo.');
      } else {
        setStatus('error');
        setMessage(data.error || 'No se pudo procesar el acceso.');
      }
    } catch {
      setStatus('error');
      setMessage('Error de conexión. Intenta de nuevo.');
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-4xl mb-2">🔍</div>
          <h1 className="text-2xl font-bold text-brand-700">OICP</h1>
          <p className="text-sm text-gray-500 mt-1">Observatorio de Integridad de Contratación Pública del Ecuador</p>
        </div>

        <div className="bg-white rounded-2xl border shadow-sm p-6">
          {linkError && status === 'idle' && (
            <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">
              {ERRORS[linkError] || 'No se pudo iniciar sesión.'}
            </div>
          )}

          {status === 'sent' ? (
            <div className="text-center py-4">
              <div className="text-3xl mb-3">📬</div>
              <p className="text-sm text-gray-700">{message}</p>
              <button onClick={() => { setStatus('idle'); setEmail(''); }} className="mt-4 text-sm text-brand-600 hover:underline">
                Usar otro correo
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">Correo electrónico</label>
                <input
                  id="email" type="email" required autoFocus value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@correo.com"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                />
              </div>
              {status === 'error' && (
                <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{message}</div>
              )}
              <button
                type="submit" disabled={status === 'sending'}
                className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white rounded-lg px-4 py-2.5 text-sm font-medium transition-colors"
              >
                {status === 'sending' ? 'Enviando…' : 'Enviarme un enlace de acceso'}
              </button>
              <p className="text-xs text-gray-400 text-center">
                Acceso por invitación. Te llegará un enlace de un solo uso, válido por 15 minutos.
              </p>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Plataforma de análisis de datos públicos OCDS · Las señales no constituyen acusación.
        </p>
      </div>
    </div>
  );
}
