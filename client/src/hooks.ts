import { DependencyList, useCallback, useEffect, useState } from 'react';
import { errorMessage } from './api';

/**
 * Load data when a component mounts (and when `deps` change).
 * Returns the data, a loading flag, any error message, and a reload function.
 */
export function useLoad<T>(load: () => Promise<T>, deps: DependencyList) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // `deps` decides when `load` should run again, like useEffect's dependency list
  const run = useCallback(load, deps);

  const reload = useCallback(async () => {
    try {
      setData(await run());
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [run]);

  useEffect(() => {
    setLoading(true);
    reload();
  }, [reload]);

  return { data, setData, error, loading, reload };
}
