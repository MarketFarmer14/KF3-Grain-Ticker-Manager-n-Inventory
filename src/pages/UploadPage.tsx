import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Camera } from 'lucide-react';
import { PERSON_OPTIONS, ORIGIN_LOCATIONS } from '../lib/constants';

export function UploadPage() {
  const navigate = useNavigate();
  const [person, setPerson] = useState(() => localStorage.getItem('grain_last_person') || '');
  const [origin, setOrigin] = useState(() => localStorage.getItem('grain_last_origin') || '');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [justUploaded, setJustUploaded] = useState(false);
  const [todayCount, setTodayCount] = useState(0);
  const [todayBushels, setTodayBushels] = useState(0);

  const currentYear = localStorage.getItem('grain_ticket_year') || new Date().getFullYear().toString();

  useEffect(() => {
    fetchTodayStats();
  }, []);

  const fetchTodayStats = async () => {
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabase
      .from('tickets')
      .select('bushels')
      .eq('crop_year', currentYear)
      .eq('deleted', false)
      .gte('created_at', today + 'T00:00:00');

    if (data) {
      setTodayCount(data.length);
      setTodayBushels(data.reduce((sum, t) => sum + (t.bushels || 0), 0));
    }
  };

  const handlePersonChange = (value: string) => {
    setPerson(value);
    if (value) localStorage.setItem('grain_last_person', value);
  };

  const handleOriginChange = (value: string) => {
    setOrigin(value);
    if (value) localStorage.setItem('grain_last_origin', value);
  };

  const handleImageCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Convert HEIC/unsupported formats to JPEG via canvas (iPhone uploads HEIC by default)
    if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) {
      try {
        const converted = await new Promise<File>((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            canvas.getContext('2d')!.drawImage(img, 0, 0);
            canvas.toBlob(
              (blob) => {
                if (!blob) { reject(new Error('Conversion failed')); return; }
                resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
              },
              'image/jpeg',
              0.92
            );
            URL.revokeObjectURL(img.src);
          };
          img.onerror = () => reject(new Error('Could not load image'));
          img.src = URL.createObjectURL(file);
        });
        setImageFile(converted);
        const reader = new FileReader();
        reader.onloadend = () => setImagePreview(reader.result as string);
        reader.readAsDataURL(converted);
      } catch {
        alert('Unsupported image format. Please use JPEG or PNG.');
        return;
      }
    } else {
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setImagePreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!imageFile) {
      alert('Please take or upload a photo of the ticket.');
      return;
    }
    if (!person) {
      alert('Please select who is hauling.');
      return;
    }

    setUploading(true);

    try {
      const fileName = `${Date.now()}-${imageFile.name}`;

      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(imageFile);
      });

      const imageBase64 = await base64Promise;

      const uploadResponse = await fetch('/.netlify/functions/upload-to-r2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, fileName }),
      });

      if (!uploadResponse.ok) {
        const error = await uploadResponse.json();
        throw new Error(error.error || 'Image upload failed');
      }

      const uploadData = await uploadResponse.json();

      const { error } = await supabase.from('tickets').insert([
        {
          ticket_date: new Date().toISOString().split('T')[0],
          person,
          crop: 'Corn',
          bushels: 0,
          delivery_location: '',
          through: 'Akron',
          image_url: uploadData.url,
          status: 'needs_review',
          origin: origin || 'upload_page',
          crop_year: currentYear,
          deleted: false,
        },
      ]);

      if (error) throw error;

      setJustUploaded(true);
      setImageFile(null);
      setImagePreview(null);
      setTodayCount((c) => c + 1);
    } catch (error: any) {
      alert('Upload failed: ' + error.message);
    } finally {
      setUploading(false);
    }
  };

  const handleAnotherLoad = () => {
    setJustUploaded(false);
    // Person stays pre-filled
  };

  // Success screen
  if (justUploaded) {
    return (
      <div className="max-w-lg mx-auto p-8 text-center">
        <div className="text-6xl mb-4">&#9989;</div>
        <h1 className="text-3xl font-bold text-white mb-2">Ticket Uploaded!</h1>
        <p className="text-gray-400 mb-8">Head to Review to AI Auto-Fill, or snap another.</p>

        <div className="bg-gray-800 rounded-lg p-4 mb-6">
          <div className="text-gray-400 text-sm">Today's Loads</div>
          <div className="text-white text-3xl font-bold">{todayCount}</div>
        </div>

        <button
          onClick={handleAnotherLoad}
          className="w-full px-4 py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-lg mb-3"
        >
          Another Load
        </button>
        <button
          onClick={() => navigate('/review')}
          className="w-full px-4 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-lg mb-3"
        >
          Go to Review
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto p-8">
      <h1 className="text-3xl font-bold text-white mb-2">Upload Ticket</h1>

      {/* Today's tally */}
      {todayCount > 0 && (
        <div className="bg-gray-800 rounded-lg p-3 mb-4 flex justify-between items-center">
          <span className="text-gray-400 text-sm">Today</span>
          <span className="text-white font-semibold">
            {todayCount} load{todayCount !== 1 ? 's' : ''}
            {todayBushels > 0 && ` \u00B7 ${todayBushels.toLocaleString()} bu`}
          </span>
        </div>
      )}

      <p className="text-gray-400 mb-6">
        Snap a photo of the grain ticket. AI will read it on the Review page.
      </p>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium mb-1 text-white">Who is hauling? *</label>
          <select
            required
            value={person}
            onChange={(e) => handlePersonChange(e.target.value)}
            className="w-full px-3 py-3 bg-gray-700 text-white rounded-lg text-lg"
          >
            <option value="">Select person</option>
            {PERSON_OPTIONS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-white">Loading from?</label>
          <select
            value={origin}
            onChange={(e) => handleOriginChange(e.target.value)}
            className="w-full px-3 py-3 bg-gray-700 text-white rounded-lg text-lg"
          >
            <option value="">Select origin (optional)</option>
            {ORIGIN_LOCATIONS.map((loc) => (
              <option key={loc} value={loc}>{loc}</option>
            ))}
          </select>
        </div>

        <div>
          {!imagePreview ? (
            <label className="cursor-pointer flex flex-col items-center justify-center gap-3 px-4 py-12 bg-gray-700 hover:bg-gray-600 text-white rounded-xl border-2 border-dashed border-gray-500 hover:border-emerald-500 transition-colors">
              <Camera size={48} className="text-emerald-400" />
              <span className="text-lg font-semibold">Tap to Take Photo</span>
              <span className="text-sm text-gray-400">or upload from gallery</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleImageCapture}
                className="hidden"
              />
            </label>
          ) : (
            <div className="space-y-3">
              <img src={imagePreview} alt="Ticket preview" className="w-full rounded-lg" />
              <button
                type="button"
                onClick={() => { setImageFile(null); setImagePreview(null); }}
                className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg"
              >
                Retake Photo
              </button>
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={uploading || !imageFile || !person}
          className="w-full px-4 py-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-600 text-white rounded-xl font-bold text-lg"
        >
          {uploading ? 'Uploading...' : 'Submit Ticket'}
        </button>
      </form>
    </div>
  );
}
