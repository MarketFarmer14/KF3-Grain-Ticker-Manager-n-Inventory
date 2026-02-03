import React, { useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';

interface UploadFileState {
  file: File;
  progress: number;
  error: string | null;
  done: boolean;
}

export const UploadPage: React.FC = () => {
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState<UploadFileState[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const validate = (fileList: FileList): { valid: File[]; errors: string[] } => {
    const valid: File[] = [];
    const errors: string[] = [];
    Array.from(fileList).forEach((file) => {
      const type = file.type;
      const isValidType = ['image/jpeg', 'image/png', 'image/heic', 'image/heif'].includes(type)
        || file.name.toLowerCase().endsWith('.heic')
        || file.name.toLowerCase().endsWith('.jpg')
        || file.name.toLowerCase().endsWith('.jpeg')
        || file.name.toLowerCase().endsWith('.png');
      if (!isValidType) {
        errors.push(`${file.name}: unsupported type (use JPG, PNG, or HEIC)`);
        return;
      }
      if (file.size > 24 * 1024 * 1024) {
        errors.push(`${file.name}: too large (max 24 MB)`);
        return;
      }
      valid.push(file);
    });
    return { valid, errors };
  };

  const startUpload = async (fileList: FileList) => {
    const { valid, errors } = validate(fileList);
    if (errors.length > 0) alert(errors.join('\n'));
    if (valid.length === 0) return;
    if (valid.length > 20) {
      alert('Maximum 20 files per batch');
      return;
    }
    await uploadFiles(valid);
  };

  const uploadFiles = async (toUpload: File[]) => {
    setUploading(true);
    const state: UploadFileState[] = toUpload.map((file) => ({
      file, progress: 0, error: null, done: false,
    }));
    setFiles([...state]);

    for (let i = 0; i < toUpload.length; i++) {
      const file = toUpload[i];
      try {
        const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
        const name = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}.${ext}`;

        state[i].progress = 30;
        setFiles([...state]);

        // Upload to storage
        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from('grain-tickets')
          .upload(name, file, { cacheControl: '3600', upsert: false });

        if (uploadErr) throw new Error(`Storage: ${uploadErr.message}`);

        state[i].progress = 65;
        setFiles([...state]);

        // Get public URL
        const { data: urlData } = supabase.storage
          .from('grain-tickets')
          .getPublicUrl(uploadData.path);

        if (!urlData?.publicUrl) throw new Error('Could not generate public URL');

        // OCR: Extract ticket data from image
        let extractedData: any = {};
        try {
          // Convert file to base64
          const base64Data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result as string;
              resolve(result.split(',')[1]); // Remove data:image/jpeg;base64, prefix
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });

          // Call Claude API for OCR
          const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "claude-sonnet-4-20250514",
              max_tokens: 1000,
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "image",
                      source: {
                        type: "base64",
                        media_type: file.type,
                        data: base64Data
                      }
                    },
                    {
                      type: "text",
                      text: "Extract grain delivery ticket information. Return ONLY valid JSON with these exact keys: ticket_number (string), ticket_date (YYYY-MM-DD format string), person (driver name string), crop (string: Corn or Soybeans), bushels (number), delivery_location (string), through (string: Akron or RVC or Cargill), moisture_percent (number). If a field is not visible, use null. Return ONLY the JSON object with no other text."
                    }
                  ]
                }
              ]
            })
          });

          const data = await response.json();

          // Parse response
          if (data.content && data.content[0] && data.content[0].text) {
            const text = data.content[0].text.trim();
            // Remove markdown code fences if present
            const cleanText = text.replace(/```json\n?|\n?```/g, '');
            extractedData = JSON.parse(cleanText);
            console.log('OCR extracted data:', extractedData);
          }
        } catch (ocrError) {
          console.error('OCR failed, using defaults:', ocrError);
          // Continue with empty data - not a fatal error
        }

        const { error: dbErr } = await supabase.from('tickets').insert({
          image_url: urlData.publicUrl,
          status: 'needs_review',
          ticket_number: extractedData.ticket_number || null,
          ticket_date: extractedData.ticket_date || new Date().toISOString().split('T')[0],
          person: extractedData.person || '',
          crop: extractedData.crop || '',
          bushels: extractedData.bushels || 0,
          delivery_location: extractedData.delivery_location || '',
          through: extractedData.through || 'Akron',
          moisture_percent: extractedData.moisture_percent || null,
          origin: '',
          crop_year: localStorage.getItem('grain_ticket_year') || '2025',
          notes: `Source: ${file.name}`,
        });

        if (dbErr) throw new Error(`Database: ${dbErr.message}`);

        state[i].progress = 100;
        state[i].done = true;
        setFiles([...state]);
      } catch (err: unknown) {
        state[i].error = (err as Error).message;
        state[i].progress = 0;
        setFiles([...state]);
      }
    }

    setUploading(false);
    const successes = state.filter((s) => s.done).length;
    if (successes > 0) {
      setTimeout(() => navigate('/review'), 2000);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-6">Upload Tickets</h1>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); startUpload(e.dataTransfer.files); }}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition
                    ${dragging ? 'border-emerald-500 bg-emerald-500/10' : 'border-gray-600 bg-gray-800 hover:border-gray-500'}`}
      >
        <div className="text-5xl mb-4">📁</div>
        <p className="text-lg text-gray-300 mb-1">Drag &amp; drop ticket images here</p>
        <p className="text-sm text-gray-500">or click to select files</p>
        <p className="text-xs text-gray-600 mt-2">JPG · PNG · HEIC — max 24 MB per file — max 20 files</p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          capture="environment"
          onChange={(e) => { if (e.target.files) startUpload(e.target.files); }}
          className="hidden"
          disabled={uploading}
        />
      </div>

      {/* Progress list */}
      {files.length > 0 && (
        <div className="mt-6 space-y-3">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">
            {uploading ? 'Uploading…' : files.every((f) => f.done || f.error) ? 'Upload Complete' : 'Upload Status'}
          </h3>
          {files.map((f, i) => (
            <div key={i} className="bg-gray-800 rounded-lg p-4">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-300 truncate mr-4">{f.file.name}</span>
                <span className={`font-medium flex-shrink-0 ${f.error ? 'text-red-400' : f.done ? 'text-emerald-400' : 'text-gray-400'}`}>
                  {f.error ? 'Failed' : f.done ? '✓ Done' : `${f.progress}%`}
                </span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-1.5">
                <div
                  className={`h-1.5 rounded-full transition-all ${f.error ? 'bg-red-600' : f.done ? 'bg-emerald-500' : 'bg-blue-500'}`}
                  style={{ width: `${f.progress}%` }}
                />
              </div>
              {f.error && <p className="text-xs text-red-400 mt-1.5">{f.error}</p>}
            </div>
          ))}
          {!uploading && files.some((f) => f.done) && (
            <p className="text-center text-gray-500 text-sm mt-2">Redirecting to Review Queue…</p>
          )}
        </div>
      )}
    </div>
  );
};
