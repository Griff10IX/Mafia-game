import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import api from '../../utils/api';

export default function SpotifyCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const run = async () => {
      const error = (searchParams.get('error') || '').trim();
      const code = (searchParams.get('code') || '').trim();
      const state = (searchParams.get('state') || '').trim();

      if (error) {
        toast.error(`Spotify connect failed: ${error}`);
        navigate('/account/profile', { replace: true });
        return;
      }
      if (!code || !state) {
        toast.error('Invalid Spotify callback.');
        navigate('/account/profile', { replace: true });
        return;
      }

      try {
        const res = await api.post('/profile/spotify/oauth-callback', { code, state });
        const msg = res.data?.message || 'Spotify connected successfully';
        try {
          window.sessionStorage.setItem('spotify_connect_message', msg);
        } catch (_) {}
      } catch (e) {
        toast.error(e.response?.data?.detail || 'Spotify connect failed');
      } finally {
        navigate('/account/profile', { replace: true });
      }
    };
    run();
  }, [navigate, searchParams]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="text-primary font-heading text-sm">Connecting Spotify...</div>
    </div>
  );
}
