// netlify/functions/chat.js — JARVIS Pro with Auth Protection

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // ═══ AUTH CHECK ═══
  const authHeader = event.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();

  if (!token) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ reply: 'Unauthorized. Please sign in.' })
    };
  }

  // Verify token with Supabase
  try {
    const verifyRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': process.env.SUPABASE_ANON_KEY
      }
    });
    if (!verifyRes.ok) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ reply: 'Session expired. Please sign in again.' })
      };
    }
  } catch(e) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ reply: 'Auth verification failed: ' + e.message })
    };
  }

  // ═══ MAIN LOGIC ═══
  try {
    const { message, image, imageMime, history = [], forceSearch } = JSON.parse(event.body || '{}');

    if (!message && !image) {
      return { statusCode: 400, headers, body: JSON.stringify({ reply: 'No message provided.' }) };
    }

    if (!process.env.GROQ_API_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ reply: 'GROQ API key missing in environment variables.' }) };
    }

    let finalReply = '';
    let modelUsed = 'GROQ LLAMA-3.3-70B';
    let searchUsed = false;
    let searchQuery = null;

    // ── IMAGE MODE ──
    if (image && process.env.GEMINI_API_KEY) {
      modelUsed = 'GEMINI 1.5 FLASH';
      try {
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { text: `You are JARVIS, a professional AI assistant. Analyze this image and answer: ${message || 'Describe this image in detail'}. Be thorough and professional.` },
                  { inline_data: { mime_type: imageMime || 'image/jpeg', data: image } }
                ]
              }]
            })
          }
        );
        const gData = await geminiRes.json();
        finalReply = gData.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!finalReply) finalReply = 'Image analysis failed — Gemini API returned empty response.';
      } catch(e) {
        finalReply = 'Image analysis error: ' + e.message;
      }
      return { statusCode: 200, headers, body: JSON.stringify({ reply: finalReply, model: modelUsed }) };
    }

    // ── SEARCH MODE ──
    const needsSearch = forceSearch || /\b(today|news|latest|current|price|weather|score|winner|who won|right now|2024|2025|recently|trending|search|find|lookup)\b/i.test(message);

    if (needsSearch && process.env.TAVILY_API_KEY) {
      searchUsed = true;
      searchQuery = message;
      let context = '';

      try {
        const tvRes = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: process.env.TAVILY_API_KEY,
            query: message,
            search_depth: 'basic',
            max_results: 5
          })
        });
        const tvData = await tvRes.json();
        if (tvData.results?.length) {
          context = tvData.results.map(r => `Source: ${r.title}\n${r.content}`).join('\n\n');
        }
      } catch(e) {
        console.log('Tavily error:', e.message);
      }

      // Use Gemini for search summary if available
      if (process.env.GEMINI_API_KEY && context) {
        modelUsed = 'GROQ + TAVILY + GEMINI';
        try {
          const gRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{
                  parts: [{
                    text: `You are JARVIS, a professional AI assistant. The user asked: "${message}"\n\nHere are real-time web search results:\n\n${context}\n\nProvide a clear, well-structured, professional answer based on these results. Use bullet points where appropriate. Be factual and concise. If the user wrote in Telugu, reply in Telugu.`
                  }]
                }]
              })
            }
          );
          const gData = await gRes.json();
          finalReply = gData.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } catch(e) {
          console.log('Gemini summary error:', e.message);
        }
      }

      // Fallback to GROQ
      if (!finalReply) {
        const systemPrompt = context
          ? `You are JARVIS, a professional AI assistant. Use this search data to answer: ${context}`
          : `You are JARVIS, a professional AI assistant. Answer based on your knowledge.`;

        const gRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: message }],
            temperature: 0.5, max_tokens: 800
          })
        });
        const gData = await gRes.json();
        finalReply = gData.choices?.[0]?.message?.content || 'Search completed but no answer generated.';
        modelUsed = 'GROQ + TAVILY';
      }

    } else {
      // ── CHAT MODE ──
      const messages = [
        {
          role: 'system',
          content: `You are JARVIS — a professional, intelligent AI assistant. Be helpful, clear, and concise. Use markdown formatting (bold, bullet points) where it helps clarity. If the user writes in Telugu, respond in Telugu. Keep responses focused and relevant.`
        },
        ...history.slice(-8),
        { role: 'user', content: message }
      ];

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages, temperature: 0.7, max_tokens: 600 })
      });
      const data = await res.json();
      finalReply = data.choices?.[0]?.message?.content || 'No response generated.';
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reply: finalReply, model: modelUsed, searchUsed, searchQuery })
    };

  } catch(error) {
    console.error('JARVIS Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ reply: 'Server error: ' + error.message })
    };
  }
};
