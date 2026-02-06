export interface Database {
  public: {
    Tables: {
      tickets: {
        Row: {
          id: string;
          ticket_date: string;
          ticket_number: string | null;
          person: string;
          crop: string;
          bushels: number;
          delivery_location: string;
          through: string;
          elevator: string | null;
          contract_id: string | null;
          status: 'needs_review' | 'approved' | 'rejected' | 'hold';
          image_url: string | null;
          duplicate_flag: boolean;
          duplicate_group: string | null;
          notes: string | null;
          origin: string;
          moisture_percent: number | null;
          crop_year: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['tickets']['Row'], 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['tickets']['Insert']>;
      };
      contracts: {
        Row: {
          id: string;
          contract_number: string;
          crop: string;
          owner: string | null;
          buyer: string | null;
          destination: string;
          through: string | null;
          contracted_bushels: number;
          delivered_bushels: number;
          remaining_bushels: number;
          percent_filled: number | null;
          start_date: string | null;
          end_date: string | null;
          priority: number;
          overfill_allowed: boolean;
          is_template: boolean;
          notes: string | null;
          crop_year: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['contracts']['Row'], 'id' | 'created_at' | 'updated_at' | 'remaining_bushels' | 'percent_filled'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['contracts']['Insert']>;
      };
      ticket_audit: {
        Row: {
          id: string;
          ticket_id: string | null;
          action: string;
          old_values: Record<string, unknown> | null;
          new_values: Record<string, unknown> | null;
          changed_at: string;
        };
        Insert: Omit<Database['public']['Tables']['ticket_audit']['Row'], 'id' | 'changed_at'> & {
          id?: string;
          changed_at?: string;
        };
        Update: Partial<Database['public']['Tables']['ticket_audit']['Insert']>;
      };
    };
  };
}
