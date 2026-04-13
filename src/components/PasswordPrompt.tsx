'use client';

import { useState, useRef, useEffect } from 'react';

interface PasswordPromptProps {
  onSubmit: (password: string) => void;
  onClose: () => void;
  error: boolean;
}

export default function PasswordPrompt({ onSubmit, onClose, error }: PasswordPromptProps) {
  const [password, setPassword] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(password);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-sm p-6 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-zinc-100 mb-4">Accès aux paramètres</h2>
        <form onSubmit={handleSubmit}>
          <label className="block text-xs text-zinc-500 mb-1">Mot de passe</label>
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
            placeholder="Entrez le mot de passe"
          />
          {error && (
            <p className="text-sm text-red-400 mt-2">Mot de passe incorrect</p>
          )}
          <div className="flex justify-end gap-3 mt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Valider
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
