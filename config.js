// Configuración pública (la clave "anon" es pública por diseño: la seguridad la ponen
// el login y las reglas RLS de la base de datos, que solo dejan entrar a usuarias admin).
window.ERP_CONFIG = {
  supabaseUrl: 'https://bkcvewmniiwfezqrrovv.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJrY3Zld21uaWl3ZmV6cXJyb3Z2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NDQ0NDQsImV4cCI6MjEwNDQyMDQ0NH0.gxhnojNXniW2PqusAJ0EI2mQSnQRsZa-ql88gOEi7TY',
  dominioUsuarios: 'erp-trucks.local'
};
