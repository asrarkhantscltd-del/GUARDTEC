// AI assistant chat proxy (n8n webhook).
//
// Registered from server.js: require('./routes/aiChat')(deps)

module.exports = function registerAiChatRoutes(deps) {
  var app = deps.app,
    loadAllStaff = deps.loadAllStaff,
    loadVehicles = deps.loadVehicles,
    requireLogin = deps.requireLogin;

  // ── AI CHAT ───────────────────────────────────────────────────────────────────
  app.post('/api/ai-chat', requireLogin, async function(req, res) {
    var message = (req.body.message || '').trim();
    if (!message) return res.status(400).json({ error: 'Message required' });

    var webhookUrl = process.env.N8N_AI_WEBHOOK;
    if (!webhookUrl) return res.status(503).json({ error: 'AI service not configured' });

    try {
      var staffList = loadAllStaff();
      var vehicles  = await loadVehicles();

      var staffData = staffList.map(function(s) {
        return {
          name:         s.name,
          deployStatus: s.deployStatus || null,
          currentSite:  s.currentSite  || null,
          sia:  s.sia  ? { number: s.sia.number,  expiry: s.sia.expiry  } : null,
          cscs: s.cscs ? { number: s.cscs.number, expiry: s.cscs.expiry } : null,
          visa: s.visa ? { type:   s.visa.type,   expiry: s.visa.expiry } : null,
        };
      });

      var fleetData = vehicles.map(function(v) {
        return {
          registration:     v.registration     || null,
          make:             v.make             || null,
          model:            v.model            || null,
          status:           v.status           || null,
          mot_expiry:       v.mot_expiry       || null,
          insurance_expiry: v.insurance_expiry || null,
        };
      });

      var n8nRes = await fetch(webhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message, staffData, fleetData }),
        signal:  AbortSignal.timeout(30000),
      });

      if (!n8nRes.ok) throw new Error('n8n webhook returned ' + n8nRes.status);
      var data = await n8nRes.json();
      var answer = data.answer || data.response || data.output ||
                   (data.choices && data.choices[0]?.message?.content) ||
                   'No response received.';
      res.json({ answer });
    } catch (err) {
      console.error('[AI Chat]', err.message);
      res.status(500).json({ error: 'AI service unavailable — please try again.' });
    }
  });
};
