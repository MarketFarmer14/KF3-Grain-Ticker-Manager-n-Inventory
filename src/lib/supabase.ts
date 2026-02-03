import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const supabaseUrl = 'https://fvosjvbemkrflymmvzdq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ2b3NqdmJlbWtyZmx5bW12emRxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MzAyMTYsImV4cCI6MjA4NTQwNjIxNn0.fBBfFbVCvxmJyGB5QvyDpdOpEDQ9XfFadhXEN_HoLPw';

export const supabase = createClient<Database>(supabaseUrl, supabaseKey);
