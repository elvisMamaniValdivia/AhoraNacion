import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { Block, BlockType, BLOCK_LABEL } from './types';
import { fromInput, toInput } from './time';
import { btn, ErrorBox, Field, input, Modal } from './ui';

export function BlockModal({
  onClose,
  initialStart,
  initialEnd,
}: {
  onClose: () => void;
  initialStart?: string;
  initialEnd?: string;
}) {
  const qc = useQueryClient();
  const [type, setType] = useState<BlockType>('ALMUERZO');
  const [title, setTitle] = useState('Almuerzo');
  const [start, setStart] = useState(initialStart ? toInput(initialStart) : '');
  const [end, setEnd] = useState(initialEnd ? toInput(initialEnd) : '');

  const create = useMutation({
    mutationFn: () =>
      api<Block>('/api/blocks', {
        method: 'POST',
        body: {
          type,
          title,
          startsAt: fromInput(start),
          endsAt: fromInput(end),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries();
      onClose();
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!start || !end || !title.trim()) return;
    create.mutate();
  };

  return (
    <Modal title="Bloquear periodo en agenda" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-xs text-slate-600">
          Los bloqueos impiden que los asistentes programen citas en este horario (almuerzos, traslados, viajes, etc.).
        </p>

        <Field label="Tipo de bloqueo">
          {(id) => (
            <select
              id={id}
              className={input}
              value={type}
              onChange={(e) => {
                const t = e.target.value as BlockType;
                setType(t);
                if (!title || Object.values(BLOCK_LABEL).includes(title)) {
                  setTitle(BLOCK_LABEL[t]);
                }
              }}
            >
              {Object.entries(BLOCK_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field label="Título descriptivo *">
          {(id) => (
            <input
              id={id}
              className={input}
              value={title}
              required
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Inicio (hora de Lima) *">
            {(id) => (
              <input
                id={id}
                type="datetime-local"
                step={300}
                required
                className={input}
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            )}
          </Field>
          <Field label="Fin (hora de Lima) *">
            {(id) => (
              <input
                id={id}
                type="datetime-local"
                step={300}
                required
                className={input}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            )}
          </Field>
        </div>

        <ErrorBox error={create.error} />

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
          <button type="button" className={btn.secondary} onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className={btn.primary} disabled={create.isPending}>
            {create.isPending ? 'Guardando…' : 'Crear bloqueo'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
