import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Camera, Sparkles } from 'lucide-react';

export function UploadPage() {
  const [formData, setFormData] = useState({
    ticket_date: new Date().toISOString().split('T')[0],
    ticket_number: '',
    person: '',
    crop: '',
    bushels: '',
    delivery_location: '',
    through: '',
    truck: '',
    moisture_percent: '',
    notes: '',
  });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [aiProcessing, setAiProcessing] = useState(false);

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

  const handleAIRead = async () => {
    if (!imagePreview) {
      alert('Please capture an image first');
      return;
    }

    setAiProcessing(true);

    try {
      // Convert base64 to just the data part (remove data:image/jpeg;base64,)
      const base64Data = imagePreview.split(',')[1];

      // Call Netlify function
      const response = await fetch('/.netlify/functions/read-ticket', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ imageBase64: base64Data }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'AI reading failed');
      }

      const data = await response.json();

      // Auto-fill form with AI-extracted data
      setFormData({
        ticket_date: data.ticket_date || formData.ticket_date,
        ticket_number: data.ticket_number || '',
        person: data.person || '',
        crop: data.crop || '',
        bushels: data.bushels ? data.bushels.toString() : '',
        delivery_location: data.delivery_location || '',
        through: data.through || '',
        truck: data.truck || '',
        moisture_percent: data.moisture_percent ? data.moisture_percent.toString() : '',
        notes: data.notes || '',
      });

      alert('✅ Ticket data extracted! Please review and edit if needed.');
    } catch (error: any) {
      alert('AI reading failed: ' + error.message);
      console.error('AI Error:', error);
    } finally {
      setAiProcessing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploading(true);

    try {
      let imageUrl = null;

      if (imageFile) {
        const fileExt = imageFile.name.split('.').pop();
        const fileName = `${Date.now()}.${fileExt}`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('ticket-images')
          .upload(fileName, imageFile);

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from('ticket-images')
          .getPublicUrl(fileName);

        imageUrl = urlData.publicUrl;
      }

      const { error } = await supabase.from('tickets').insert([
        {
          ...formData,
          bushels: parseFloat(formData.bushels),
          moisture_percent: formData.moisture_percent ? parseFloat(formData.moisture_percent) : null,
          image_url: imageUrl,
          status: 'needs_review',
          origin: 'upload_page',
          crop_year: currentYear,
          deleted: false,
        },
      ]);

      if (error) throw error;

      alert('Ticket uploaded successfully!');
      setFormData({
        ticket_date: new Date().toISOString().split('T')[0],
        ticket_number: '',
        person: '',
        crop: '',
        bushels: '',
        delivery_location: '',
        through: '',
        truck: '',
        moisture_percent: '',
        notes: '',
      });
      setImageFile(null);
      setImagePreview(null);
    } catch (error: any) {
      alert('Upload failed: ' + error.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-3xl font-bold text-white mb-6">Upload Ticket</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Image Capture Section */}
        <div className="bg-gray-800 rounded-lg p-4 mb-6">
          <label className="block text-sm font-medium mb-2 text-white">Ticket Image</label>
          <div className="flex flex-wrap items-center gap-3">
            <label className="cursor-pointer flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
              <Camera size={20} />
              <span>Capture/Upload Image</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleImageCapture}
                className="hidden"
              />
            </label>

            {imagePreview && (
              <>
                <button
                  type="button"
                  onClick={handleAIRead}
                  disabled={aiProcessing}
                  className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white rounded-lg font-semibold"
                >
                  <Sparkles size={20} />
                  <span>{aiProcessing ? 'Reading...' : '🤖 Auto-Fill from Image'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setImageFile(null);
                    setImagePreview(null);
                  }}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg"
                >
                  Remove Image
                </button>
              </>
            )}
          </div>
          {imagePreview && (
            <img src={imagePreview} alt="Preview" className="mt-4 max-w-md rounded-lg" />
          )}
        </div>

        {/* Form Fields */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1 text-white">Date *</label>
            <input
              type="date"
              required
              value={formData.ticket_date}
              onChange={(e) => setFormData({ ...formData, ticket_date: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-white">Ticket Number</label>
            <input
              type="text"
              value={formData.ticket_number}
              onChange={(e) => setFormData({ ...formData, ticket_number: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-white">Person/Owner *</label>
            <input
              type="text"
              required
              value={formData.person}
              onChange={(e) => setFormData({ ...formData, person: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-white">Crop *</label>
            <select
              required
              value={formData.crop}
              onChange={(e) => setFormData({ ...formData, crop: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg"
            >
              <option value="">Select crop</option>
              <option value="Corn">Corn</option>
              <option value="Soybeans">Soybeans</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-white">Bushels *</label>
            <input
              type="number"
              step="0.01"
              required
              value={formData.bushels}
              onChange={(e) => setFormData({ ...formData, bushels: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-white">Location *</label>
            <input
              type="text"
              required
              value={formData.delivery_location}
              onChange={(e) => setFormData({ ...formData, delivery_location: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg"
              placeholder="e.g., Cargill-Lacon"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-white">Through *</label>
            <select
              required
              value={formData.through}
              onChange={(e) => setFormData({ ...formData, through: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg"
            >
              <option value="">Select</option>
              <option value="Akron">Akron</option>
              <option value="RVC">RVC</option>
              <option value="Cargill">Cargill</option>
              <option value="ADM">ADM</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-white">Truck #</label>
            <input
              type="text"
              value={formData.truck}
              onChange={(e) => setFormData({ ...formData, truck: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg"
              placeholder="e.g., Truck 1, John's Peterbilt"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-white">Moisture %</label>
            <input
              type="number"
              step="0.1"
              value={formData.moisture_percent}
              onChange={(e) => setFormData({ ...formData, moisture_percent: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-white">Notes</label>
          <textarea
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg"
            rows={3}
          />
        </div>

        <button
          type="submit"
          disabled={uploading}
          className="w-full px-4 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white rounded-lg font-bold"
        >
          {uploading ? 'Uploading...' : 'Upload Ticket'}
        </button>
      </form>
    </div>
  );
}
