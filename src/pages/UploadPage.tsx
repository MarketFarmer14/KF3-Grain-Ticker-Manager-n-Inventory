import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Camera } from 'lucide-react';
import { PERSON_OPTIONS } from '../lib/constants';

export function UploadPage() {
  const [person, setPerson] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const currentYear = localStorage.getItem('grain_ticket_year') || new Date().getFullYear().toString();

  const handleImageCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
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
      let imageUrl = null;

      // Upload image to Cloudflare R2
      const fileName = `${Date.now()}-${imageFile.name}`;

      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          const result = reader.result as string;
          const base64 = result.split(',')[1];
          resolve(base64);
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
      imageUrl = uploadData.url;

      // Save ticket to Supabase with minimal info - AI fills the rest on Review
      const { error } = await supabase.from('tickets').insert([
        {
          ticket_date: new Date().toISOString().split('T')[0],
          person: person,
          crop: 'Corn',
          bushels: 0,
          delivery_location: '',
          through: 'Akron',
          image_url: imageUrl,
          status: 'needs_review',
          origin: 'upload_page',
          crop_year: currentYear,
          deleted: false,
        },
      ]);

      if (error) throw error;

      alert('Ticket uploaded! Head to Review to use AI Auto-Fill.');
      setPerson('');
      setImageFile(null);
      setImagePreview(null);
    } catch (error: any) {
      alert('Upload failed: ' + error.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto p-8">
      <h1 className="text-3xl font-bold text-white mb-2">Upload Ticket</h1>
      <p className="text-gray-400 mb-6">
        Snap a photo of the grain ticket. AI will read it on the Review page.
      </p>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Person selector */}
        <div>
          <label className="block text-sm font-medium mb-1 text-white">Who is hauling? *</label>
          <select
            required
            value={person}
            onChange={(e) => setPerson(e.target.value)}
            className="w-full px-3 py-3 bg-gray-700 text-white rounded-lg text-lg"
          >
            <option value="">Select person</option>
            {PERSON_OPTIONS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        {/* Image capture - big and prominent */}
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
                onClick={() => {
                  setImageFile(null);
                  setImagePreview(null);
                }}
                className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg"
              >
                Retake Photo
              </button>
            </div>
          )}
        </div>

        {/* Submit */}
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
