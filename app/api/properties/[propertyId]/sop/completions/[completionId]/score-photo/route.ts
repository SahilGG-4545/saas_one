import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/frontend/utils/supabase/server';
import { supabaseAdmin } from '@/backend/lib/supabase/admin';
import Groq from 'groq-sdk';
import sharp from 'sharp';

/**
 * POST /api/properties/[propertyId]/sop/completions/[completionId]/score-photo
 * AI cleanliness scoring: evaluates the uploaded step photo against the step's
 * reference benchmark and inspects each configured parameter individually.
 * Primary Model: Qwen 3.8 27B Vision via engy.ai (with fallback to Groq Qwen 3.6 27B)
 * Body: { completionItemId }
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ propertyId: string; completionId: string }> }
) {
    const { propertyId, completionId } = await params;
    const supabase = await createClient();

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { completionItemId } = body;

        if (!completionItemId) {
            return NextResponse.json({ error: 'completionItemId is required' }, { status: 400 });
        }

        // Verify completion belongs to this property
        let compQuery = supabaseAdmin
            .from('sop_completions')
            .select('id, template_id')
            .eq('id', completionId);

        if (propertyId && propertyId !== 'all' && propertyId !== 'undefined' && propertyId !== 'null') {
            compQuery = compQuery.eq('property_id', propertyId);
        }

        const { data: completion, error: completionError } = await compQuery.maybeSingle();

        if (completionError || !completion) {
            return NextResponse.json({ error: 'Completion not found for this property' }, { status: 404 });
        }

        // Check if property is in basic mode or has AI scoring disabled
        const { data: propSettings } = await supabaseAdmin
            .from('checklist_property_settings')
            .select('checklist_mode, ai_scoring_enabled')
            .eq('property_id', propertyId)
            .maybeSingle();

        let isBasicMode = false;
        let aiScoringDisabled = false;

        if (propSettings) {
            isBasicMode = propSettings.checklist_mode === 'basic';
            aiScoringDisabled = propSettings.ai_scoring_enabled === false;
        } else {
            const { data: prop } = await supabaseAdmin
                .from('properties')
                .select('checklist_mode')
                .eq('id', propertyId)
                .maybeSingle();
            isBasicMode = !prop || prop.checklist_mode === 'basic';
        }

        if (isBasicMode || aiScoringDisabled) {
            return NextResponse.json({
                success: true,
                skipped: true,
                reason: isBasicMode ? 'AI scoring is disabled for this property in basic mode' : 'AI scoring is disabled',
            });
        }

        // Load the completion item (field photo)
        const { data: completionItem, error: itemError } = await supabaseAdmin
            .from('sop_completion_items')
            .select('id, photo_url, checklist_item_id')
            .eq('id', completionItemId)
            .eq('completion_id', completionId)
            .maybeSingle();

        if (itemError || !completionItem) {
            return NextResponse.json({ error: 'Completion item not found' }, { status: 404 });
        }

        if (!completionItem.photo_url) {
            return NextResponse.json({ error: 'No photo uploaded for this step yet' }, { status: 400 });
        }

        // Load the checklist item (reference config & sub-parameters)
        const { data: checklistItem, error: checklistError } = await supabaseAdmin
            .from('sop_checklist_items')
            .select('id, title, reference_photo_url, reference_photo_source, cad_area_id, parameters')
            .eq('id', completionItem.checklist_item_id)
            .maybeSingle();

        if (checklistError || !checklistItem) {
            return NextResponse.json({ error: 'Checklist item not found' }, { status: 404 });
        }

        // Determine the reference image (Clean reference photo has highest priority over CAD 2D floor plan crop)
        let referenceBuffer: Buffer | null = null;
        let referenceUsed: 'cad' | 'uploaded' | null = null;

        if (checklistItem.reference_photo_url) {
            try {
                const refResponse = await fetch(checklistItem.reference_photo_url);
                if (refResponse.ok) {
                    referenceBuffer = Buffer.from(await refResponse.arrayBuffer());
                    referenceUsed = 'uploaded';
                }
            } catch (refErr) {
                console.error('[AI Score] Reference photo fetch failed:', refErr);
            }
        }

        if (!referenceBuffer && checklistItem.cad_area_id) {
            // Fallback to CAD area crop if no clean photo uploaded
            const { data: template } = await supabaseAdmin
                .from('sop_templates')
                .select('cad_converted_image_url, cad_areas')
                .eq('id', completion.template_id)
                .maybeSingle();

            if (template?.cad_converted_image_url && Array.isArray(template.cad_areas)) {
                const area = (template.cad_areas as any[]).find((a: any) => a.id === checklistItem.cad_area_id);
                if (area?.coordinates) {
                    try {
                        const cadResponse = await fetch(template.cad_converted_image_url);
                        if (cadResponse.ok) {
                            const cadBuffer = Buffer.from(await cadResponse.arrayBuffer());
                            const meta = await sharp(cadBuffer).metadata();
                            const imgW = meta.width || 0;
                            const imgH = meta.height || 0;

                            // Clamp crop region to image bounds
                            const left = Math.max(0, Math.min(Math.round(area.coordinates.x), imgW - 1));
                            const top = Math.max(0, Math.min(Math.round(area.coordinates.y), imgH - 1));
                            const width = Math.max(1, Math.min(Math.round(area.coordinates.width), imgW - left));
                            const height = Math.max(1, Math.min(Math.round(area.coordinates.height), imgH - top));

                            referenceBuffer = await sharp(cadBuffer)
                                .extract({ left, top, width, height })
                                .png()
                                .toBuffer();
                            referenceUsed = 'cad';
                        }
                    } catch (cropErr) {
                        console.error('[AI Score] CAD crop failed:', cropErr);
                    }
                }
            }
        }

        if (!referenceBuffer || !referenceUsed) {
            return NextResponse.json({
                success: true,
                skipped: true,
                reason: 'No clean reference photo or CAD area configured for this step',
            });
        }

        // Fetch the field photo
        let fieldBuffer: Buffer;
        try {
            const fieldResponse = await fetch(completionItem.photo_url);
            if (!fieldResponse.ok) throw new Error(`Photo fetch failed: ${fieldResponse.status}`);
            fieldBuffer = Buffer.from(await fieldResponse.arrayBuffer());
        } catch (photoErr: any) {
            return NextResponse.json(
                { error: `Could not load the uploaded photo: ${photoErr.message}` },
                { status: 500 }
            );
        }

        // Normalize both images for vision models (resized to 640px width for optimal balance of detail & latency)
        const [fieldPng, referencePng] = await Promise.all([
            sharp(fieldBuffer).resize({ width: 640, withoutEnlargement: true }).png().toBuffer(),
            sharp(referenceBuffer).resize({ width: 640, withoutEnlargement: true }).png().toBuffer(),
        ]);

        const fieldBase64 = `data:image/png;base64,${fieldPng.toString('base64')}`;
        const referenceBase64 = `data:image/png;base64,${referencePng.toString('base64')}`;

        // Prepare parameter inspection criteria if parameters exist on the step
        const stepParams: any[] = Array.isArray(checklistItem.parameters) ? checklistItem.parameters : [];
        const hasParameters = stepParams.length > 0;

        let promptText = '';
        if (hasParameters) {
            const paramList = stepParams.map(p => `- ${p.name || p.title}`).join('\n');
            promptText = `You are an expert commercial facilities cleanliness auditor.
Checklist Step: "${checklistItem.title}"
Reference Standard: Image 1 is the clean standard benchmark photo / CAD area.
Submitted Execution: Image 2 is the field photo taken by the cleaner after execution.

Inspect Image 2 against the clean standard in Image 1 for EACH of the following configured parameters:
${paramList}

For EACH parameter above:
1. "is_assessable": Determine if the parameter is visible in the camera view. If it is hidden behind a wall, not in frame, or too far away to inspect reliably, set "is_assessable": false, "status": "not_assessable", "score": null, and explain in "reason". DO NOT guess or give a free pass for invisible items.
2. If visible, evaluate cleanliness (0 to 100):
   - 90-100: Pristine / Spotless.
   - 75-89: Good / Acceptable.
   - 50-74: Needs Attention (visible minor defect/litter).
   - 0-49: Poor / Failed clean.
   Set "status": "pass" (>=80), "needs_attention" (50-79), or "fail" (<50).
3. "reason": A concise, clear 1-sentence visual observation explaining what you see.

Calculate "overall_score" as the integer average of the assessable parameters (0-100). If no parameters are assessable, set overall_score to 0 with pass: false.
Set "overall_reason": A 1-2 sentence summary explaining the overall state of the area.
Set "pass": true if overall_score >= 70, otherwise false.

Respond ONLY with raw JSON matching this exact structure:
{
  "overall_score": 85,
  "overall_reason": "Summary assessment of cleanliness...",
  "pass": true,
  "parameters": [
    {
      "name": "<parameter name>",
      "is_assessable": true,
      "score": 90,
      "status": "pass",
      "reason": "<1-sentence visual reason>"
    }
  ]
}`;
        } else {
            promptText = `You are an expert commercial facilities cleanliness auditor.
Checklist Step: "${checklistItem.title}"
Image 1: Clean standard benchmark reference.
Image 2: Uploaded completion photo submitted by staff.

Compare Image 2 directly against Image 1.
Scoring:
- 90-100: Pristine / Spotless.
- 75-89: Good / Acceptable.
- 50-74: Needs Attention.
- 0-49: Poor / Fail.

Return ONLY a valid raw JSON object:
{
  "score": <integer 0..100>,
  "reason": "<1-2 sentence detailed visual assessment>",
  "pass": <boolean>
}`;
        }

        // Try engy.ai first (OpenAI-compatible endpoint with Qwen 3.8 27B Vision), then fallback to Groq
        const engyKey = process.env.engy || process.env.COUNCIL_API_KEY;
        const engyBaseUrl = process.env.COUNCIL_BASE_URL || 'https://api.engy.ai/v1';

        let rawText = '';
        let modelUsed = '';

        if (engyKey) {
            try {
                const engyRes = await fetch(`${engyBaseUrl}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${engyKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: 'qwen3.8-27b',
                        messages: [
                            {
                                role: 'system',
                                content: 'You are an expert cleanliness auditor. Output raw JSON only with no markdown wrapping.',
                            },
                            {
                                role: 'user',
                                content: [
                                    { type: 'text', text: promptText },
                                    { type: 'image_url', image_url: { url: referenceBase64 } },
                                    { type: 'image_url', image_url: { url: fieldBase64 } },
                                ],
                            },
                        ],
                        max_tokens: 2048,
                        temperature: 0.1,
                        response_format: { type: 'json_object' },
                    }),
                });

                if (engyRes.ok) {
                    const engyData = await engyRes.json();
                    rawText = engyData.choices?.[0]?.message?.content ?? '';
                    modelUsed = 'qwen3.8-27b (engy.ai)';
                } else {
                    console.warn('[AI Score] engy.ai returned status:', engyRes.status, await engyRes.text().catch(() => ''));
                }
            } catch (engyErr) {
                console.warn('[AI Score] engy.ai request failed, attempting Groq fallback:', engyErr);
            }
        }

        // Groq Fallback
        if (!rawText) {
            const groqApiKey = process.env.GROQ_API_KEY || process.env.GROQ_LAYOUT_API_KEY;
            if (groqApiKey) {
                try {
                    const groq = new Groq({ apiKey: groqApiKey });
                    const visionModel = process.env.GROQ_VISION_MODEL || 'qwen/qwen3.6-27b';
                    const completion_ = await groq.chat.completions.create({
                        model: visionModel,
                        messages: [
                            {
                                role: 'system',
                                content: 'You are an expert cleanliness auditor. Output raw JSON only.',
                            },
                            {
                                role: 'user',
                                content: [
                                    { type: 'text', text: promptText },
                                    { type: 'image_url', image_url: { url: referenceBase64 } },
                                    { type: 'image_url', image_url: { url: fieldBase64 } },
                                ],
                            },
                        ],
                        max_tokens: 2048,
                        temperature: 0.1,
                        response_format: { type: 'json_object' },
                    });
                    rawText = completion_.choices[0]?.message?.content ?? '';
                    modelUsed = `${visionModel} (groq)`;
                } catch (groqErr) {
                    console.error('[AI Score] Groq call also failed:', groqErr);
                }
            }
        }

        if (!rawText) {
            return NextResponse.json({ error: 'AI vision scoring service unavailable' }, { status: 503 });
        }

        // Robust JSON extraction
        const cleanText = rawText
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/<think>[\s\S]*/gi, '')
            .replace(/```json/gi, '')
            .replace(/```/g, '')
            .trim();

        let parsed: any = null;
        try {
            parsed = JSON.parse(cleanText);
        } catch {
            const match = cleanText.match(/\{[\s\S]*?\}/);
            if (match) {
                try {
                    parsed = JSON.parse(match[0]);
                } catch {
                    parsed = null;
                }
            }
        }

        let scoreVal: number | null = typeof parsed?.overall_score === 'number'
            ? parsed.overall_score
            : typeof parsed?.score === 'number'
            ? parsed.score
            : null;

        let reasonVal: string = parsed?.overall_reason || parsed?.reason || '';
        let parameterScores: any[] = Array.isArray(parsed?.parameters) ? parsed.parameters : [];

        // Fallback regex for score if needed
        if (scoreVal === null) {
            const scoreMatch = rawText.match(/"?(?:overall_)?score"?\s*:\s*(\d+)/i);
            if (scoreMatch) {
                scoreVal = parseInt(scoreMatch[1], 10);
            }
        }

        if (!reasonVal) {
            const reasonMatch = rawText.match(/"?(?:overall_)?reason"?\s*:\s*"([^"]+)"/i);
            if (reasonMatch) {
                reasonVal = reasonMatch[1];
            }
        }

        if (scoreVal === null || isNaN(scoreVal)) {
            console.error('[AI Score] Unreadable response from model:', rawText);
            return NextResponse.json(
                { error: 'AI returned an unreadable response', raw: rawText.slice(0, 500) },
                { status: 502 }
            );
        }

        const score = Math.max(0, Math.min(100, Math.round(scoreVal)));
        const reason = reasonVal || 'Cleanliness evaluation completed.';
        const pass = typeof parsed?.pass === 'boolean' ? parsed.pass : score >= 70;

        // Persist the score, detailed explanation, and parameter scores
        const { error: updateError } = await supabaseAdmin
            .from('sop_completion_items')
            .update({
                ai_cleanliness_score: score,
                ai_cleanliness_reason: reason,
                ai_parameter_scores: parameterScores,
                ai_reference_used: referenceUsed,
                ai_analyzed_at: new Date().toISOString(),
            })
            .eq('id', completionItemId);

        if (updateError) {
            return NextResponse.json({ error: updateError.message }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            score,
            reason,
            pass,
            parameters: parameterScores,
            referenceUsed,
            modelUsed,
        });
    } catch (err) {
        console.error('[AI Score] Error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
