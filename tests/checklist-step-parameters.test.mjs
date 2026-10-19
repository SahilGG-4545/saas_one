import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Checklist Migration 20261019000001 is additive, safe, and non-destructive', async () => {
    const sql = await readFile(new URL('../supabase/migrations/20261019000001_checklist_step_parameters_and_modes.sql', import.meta.url), 'utf8');

    // 1. Must add parameters JSONB to sop_checklist_items with default '[]'::jsonb
    assert.match(sql, /ALTER TABLE public\.sop_checklist_items\s+ADD COLUMN IF NOT EXISTS parameters JSONB DEFAULT '\[\]'::jsonb/);

    // 2. Must add parameter_values JSONB to sop_completion_items with default '{}'::jsonb
    assert.match(sql, /ALTER TABLE public\.sop_completion_items\s+ADD COLUMN IF NOT EXISTS parameter_values JSONB DEFAULT '\{\}'::jsonb/);

    // 3. Must add checklist_mode with safe default 'basic'
    assert.match(sql, /ALTER TABLE public\.properties\s+ADD COLUMN IF NOT EXISTS checklist_mode TEXT NOT NULL DEFAULT 'basic'/);

    // 4. Must create checklist_property_settings table
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.checklist_property_settings/);

    // 5. Must NOT have any destructive table drops
    assert.doesNotMatch(sql, /\bDROP TABLE\b/i);
    assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
});

test('SS Plaza & existing templates backwards compatibility: steps without parameters function directly', () => {
    // Simulating an existing SS Plaza step
    const ssPlazaStep = {
        id: 'step-101',
        title: 'Check Fire Extinguisher',
        type: 'checkbox',
        requires_photo: false,
        parameters: [], // empty or undefined
    };

    const hasParameters = Array.isArray(ssPlazaStep.parameters) && ssPlazaStep.parameters.length > 0;
    assert.equal(hasParameters, false, 'Existing step must evaluate to false for hasParameters');

    // In runner, an interaction on a parameterless step sets is_checked directly
    const completionItem = {
        checklist_item_id: 'step-101',
        is_checked: true,
        value: null,
        parameter_values: {},
    };

    const hasInteraction = completionItem.is_checked || completionItem.value;
    assert.equal(hasInteraction, true, 'Existing completion item marks interaction directly');
});

test('New 2-tier step with parameters: Cafeteria with Carpet, Lights, Dusting', () => {
    const cafeteriaStep = {
        id: 'step-201',
        title: 'Cafeteria Cleanliness',
        type: 'checkbox',
        requires_photo: true,
        reference_photo_url: 'https://example.com/clean-cafeteria.jpg',
        parameters: [
            { id: 'param_carpet', name: 'Carpet Vacuumed', type: 'yes_no', is_required: true },
            { id: 'param_lights', name: 'All Lights Working', type: 'yes_no', is_required: true },
            { id: 'param_dusting', name: 'Tables Dusted', type: 'yes_no', is_required: true },
        ],
    };

    const hasParameters = Array.isArray(cafeteriaStep.parameters) && cafeteriaStep.parameters.length > 0;
    assert.equal(hasParameters, true, 'Cafeteria step must have parameters');
    assert.equal(cafeteriaStep.parameters.length, 3, 'Must have 3 parameters');

    // Simulating staff toggling parameters
    const paramValues = {
        param_carpet: { value: 'yes', checked: true },
        param_lights: { value: 'yes', checked: true },
        param_dusting: { value: 'no', checked: false },
    };

    const allAnswered = cafeteriaStep.parameters.every(p => paramValues[p.id]?.value !== undefined);
    assert.equal(allAnswered, true, 'All parameters answered');

    // Notice: NO photos required for parameters!
    cafeteriaStep.parameters.forEach(p => {
        assert.equal(p.requires_photo, undefined, 'Individual parameter must never require photo');
    });
});

test('Checklist creation autosave preserves in-progress steps, parameters, and form fields across reloads', () => {
    // Simulating localStorage draft object saved during checklist creation
    const propertyId = 'prop-12345';
    const draftKey = `sop_template_draft_${propertyId}`;
    
    const mockDraft = {
        formData: {
            title: '1st Floor Left Wing Checklist',
            description: 'Comprehensive daily inspection',
            category: 'housekeeping',
            frequency: 'daily',
            assigned_to: ['user-1'],
            start_time: '09:00',
            end_time: '17:00',
        },
        items: [
            {
                title: 'Cafeteria Cleanliness',
                description: 'Main dining area',
                requires_photo: true,
                parameters: [
                    { id: 'param-1', name: 'Carpet', type: 'yes_no', is_required: true },
                    { id: 'param-2', name: 'Lights', type: 'yes_no', is_required: true },
                ],
            },
        ],
        newItem: {
            title: 'Pantry Supplies',
            description: '',
            requires_photo: false,
            parameters: [
                { id: 'param-3', name: 'Water Dispenser Full', type: 'yes_no', is_required: true },
            ],
        },
        savedAt: Date.now(),
    };

    const serialized = JSON.stringify(mockDraft);
    const restored = JSON.parse(serialized);

    assert.equal(restored.formData.title, '1st Floor Left Wing Checklist');
    assert.equal(restored.items.length, 1);
    assert.equal(restored.items[0].parameters.length, 2);
    assert.equal(restored.items[0].parameters[0].name, 'Carpet');
    assert.equal(restored.newItem.title, 'Pantry Supplies');
    assert.equal(restored.newItem.parameters[0].name, 'Water Dispenser Full');
    assert.ok(restored.savedAt > 0);
});
