'use client';

import { useState, useEffect } from 'react';
import { getChecklist, ChecklistItem } from '@/lib/api';

interface PreflightChecklistProps {
  onComplete: () => void;
}

export default function PreflightChecklist({ onComplete }: PreflightChecklistProps) {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [answers, setAnswers] = useState<Record<string, boolean | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const data = await getChecklist();
        setItems(data);
        const initial: Record<string, boolean | null> = {};
        data.forEach(item => { initial[item.id] = null; });
        setAnswers(initial);
      } catch {
        setError('Impossible de charger la checklist');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const allAnswered = items.length > 0 && items.every(item => answers[item.id] !== null);
  const allYes = allAnswered && items.every(item => answers[item.id] === true);

  const handleAnswer = (id: string, value: boolean) => {
    setAnswers(prev => ({ ...prev, [id]: value }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center flex-1">
        <div className="text-zinc-500">Chargement de la checklist...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center flex-1">
        <div className="text-red-400">{error}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center flex-1">
      <div className="w-full max-w-lg">
        <h2 className="text-lg font-semibold text-zinc-100 mb-6">Vérifications avant démarrage</h2>

        <div className="space-y-3">
          {items.map(item => (
            <div key={item.id} className="flex items-center justify-between bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-4 py-3">
              <span className="text-sm text-zinc-300 flex-1 mr-4">{item.label}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => handleAnswer(item.id, true)}
                  className={`px-3 py-1 text-sm rounded-md transition-colors ${
                    answers[item.id] === true
                      ? 'bg-emerald-600 text-white'
                      : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600'
                  }`}
                >
                  Oui
                </button>
                <button
                  onClick={() => handleAnswer(item.id, false)}
                  className={`px-3 py-1 text-sm rounded-md transition-colors ${
                    answers[item.id] === false
                      ? 'bg-red-600 text-white'
                      : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600'
                  }`}
                >
                  Non
                </button>
              </div>
            </div>
          ))}
        </div>

        {allAnswered && !allYes && (
          <p className="text-sm text-amber-400 mt-4">
            Tous les points doivent être validés (Oui) pour continuer.
          </p>
        )}

        <div className="flex justify-center mt-6">
          <button
            onClick={onComplete}
            disabled={!allYes}
            className="px-8 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
          >
            Démarrer la session
          </button>
        </div>
      </div>
    </div>
  );
}
