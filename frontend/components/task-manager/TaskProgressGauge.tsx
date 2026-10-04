"use client";

import React, { useState } from 'react';
import { Building2, Users, User, CheckCircle2, Award, Info } from 'lucide-react';

export interface ProgressMetric {
    percentage: number;
    completed: number;
    total: number;
    label: string;
    sublabel?: string;
}

export interface TaskProgressGaugeProps {
    orgProgress: ProgressMetric;
    deptProgress: ProgressMetric;
    employeeProgress: ProgressMetric;
    className?: string;
}

type ArcLevel = 'org' | 'dept' | 'employee';

export default function TaskProgressGauge({
    orgProgress,
    deptProgress,
    employeeProgress,
    className = ''
}: TaskProgressGaugeProps) {
    const [hoveredLevel, setHoveredLevel] = useState<ArcLevel | null>(null);

    // SVG Coordinate Space Constants
    const VB_W = 600;
    const VB_H = 360;
    const CX = 300;
    const CY = 305;

    // Concentric Radii (Outer -> Middle -> Inner)
    const R_ORG = 230;      // Outer Arc: Organisation Progress
    const R_DEPT = 185;     // Middle Arc: Department Progress
    const R_EMP = 140;      // Inner Arc: Employee Progress
    const STROKE_WIDTH = 20;

    // Helper: Calculate Semi-Circular Arc Path & Circumference
    // The path begins on the left (CX - R, CY) and sweeps clockwise to the right (CX + R, CY).
    // Sweep-flag = 1 ensures it curves upward across the top.
    const getArcGeometry = (radius: number, pct: number) => {
        const circumference = Math.PI * radius;
        const clampedPct = Math.max(0, Math.min(100, isNaN(pct) ? 0 : pct));
        // Fill Left -> Right: strokeDashoffset decreases from circumference to 0
        const strokeDashoffset = circumference - (clampedPct / 100) * circumference;
        const pathData = `M ${CX - radius} ${CY} A ${radius} ${radius} 0 0 1 ${CX + radius} ${CY}`;
        return { circumference, strokeDashoffset, pathData, clampedPct };
    };

    const orgGeom = getArcGeometry(R_ORG, orgProgress.percentage);
    const deptGeom = getArcGeometry(R_DEPT, deptProgress.percentage);
    const empGeom = getArcGeometry(R_EMP, employeeProgress.percentage);

    // Active focused metric (defaults to Organisation when not hovering)
    const activeLevel: ArcLevel = hoveredLevel || 'org';
    const activeMetric = 
        activeLevel === 'employee' ? employeeProgress :
        activeLevel === 'dept' ? deptProgress : orgProgress;

    const activeColor =
        activeLevel === 'employee' ? '#F59E0B' :
        activeLevel === 'dept' ? '#10B981' : '#6366F1';

    // Polar coordinates for tick marks
    const polarToCartesian = (radius: number, angleDegrees: number) => {
        const rad = (angleDegrees * Math.PI) / 180;
        return {
            x: CX + radius * Math.cos(rad),
            y: CY - radius * Math.sin(rad)
        };
    };

    return (
        <div className={`w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm ${className}`}>
            {/* Header / Title */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 mb-2 border-b border-zinc-100 dark:border-zinc-800/80">
                <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500/10 via-emerald-500/10 to-amber-500/10 border border-indigo-200 dark:border-indigo-900/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                        <Award className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                            Progress Hierarchy Meter
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-900">
                                3-Tier Dynamic Arcs
                            </span>
                        </h3>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            Left-to-right filling arcs: Organisation (Outer), Department (Middle), Employee (Inner)
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2 text-xs text-zinc-400">
                    <Info className="w-3.5 h-3.5 text-zinc-400" />
                    <span className="hidden sm:inline">Hover arcs or cards to inspect levels</span>
                </div>
            </div>

            {/* Gauge SVG Container */}
            <div className="relative w-full max-w-[560px] mx-auto select-none">
                <svg
                    viewBox={`0 0 ${VB_W} ${VB_H}`}
                    className="w-full h-auto overflow-visible"
                    role="img"
                    aria-label={`Task Progress Gauge: Org ${orgProgress.percentage}%, Dept ${deptProgress.percentage}%, Employee ${employeeProgress.percentage}%`}
                >
                    <defs>
                        {/* Outer Arc (Organisation) Gradient */}
                        <linearGradient id="org-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#818CF8" />
                            <stop offset="50%" stopColor="#6366F1" />
                            <stop offset="100%" stopColor="#4F46E5" />
                        </linearGradient>

                        {/* Middle Arc (Department) Gradient */}
                        <linearGradient id="dept-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#34D399" />
                            <stop offset="50%" stopColor="#10B981" />
                            <stop offset="100%" stopColor="#059669" />
                        </linearGradient>

                        {/* Inner Arc (Employee) Gradient */}
                        <linearGradient id="emp-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#FBBF24" />
                            <stop offset="50%" stopColor="#F59E0B" />
                            <stop offset="100%" stopColor="#EA580C" />
                        </linearGradient>

                        {/* Drop Glow Filter for Active Arc */}
                        <filter id="gauge-glow" x="-20%" y="-20%" width="140%" height="140%">
                            <feGaussianBlur stdDeviation="3.5" result="blur" />
                            <feMerge>
                                <feMergeNode in="blur" />
                                <feMergeNode in="SourceGraphic" />
                            </feMerge>
                        </filter>
                    </defs>

                    {/* Scale Bezel / Precision Ticks (Outer Boundary) */}
                    <g opacity="0.45" className="transition-opacity">
                        {Array.from({ length: 21 }, (_, i) => {
                            const pct = i * 5;
                            const isMajor = pct % 25 === 0;
                            const angle = 180 - (pct / 100) * 180;
                            const rIn = R_ORG + STROKE_WIDTH / 2 + 8;
                            const rOut = rIn + (isMajor ? 10 : 5);
                            const p1 = polarToCartesian(rIn, angle);
                            const p2 = polarToCartesian(rOut, angle);
                            return (
                                <line
                                    key={pct}
                                    x1={p1.x}
                                    y1={p1.y}
                                    x2={p2.x}
                                    y2={p2.y}
                                    stroke="currentColor"
                                    strokeWidth={isMajor ? 2 : 1}
                                    strokeLinecap="round"
                                    className="text-zinc-400 dark:text-zinc-600"
                                />
                            );
                        })}
                    </g>

                    {/* Scale Label Numbers: 0%, 50%, 100% */}
                    <g className="text-zinc-400 dark:text-zinc-500 text-[11px] font-semibold select-none">
                        {/* 0% Left */}
                        <text
                            x={CX - R_ORG - STROKE_WIDTH / 2 - 2}
                            y={CY + 18}
                            textAnchor="middle"
                            fill="currentColor"
                        >
                            0%
                        </text>
                        {/* 50% Center Top */}
                        <text
                            x={CX}
                            y={CY - R_ORG - STROKE_WIDTH / 2 - 14}
                            textAnchor="middle"
                            fill="currentColor"
                        >
                            50%
                        </text>
                        {/* 100% Right */}
                        <text
                            x={CX + R_ORG + STROKE_WIDTH / 2 + 6}
                            y={CY + 18}
                            textAnchor="middle"
                            fill="currentColor"
                        >
                            100%
                        </text>
                    </g>

                    {/* ───────────────────────────────────────────────────────────── */}
                    {/* ARC 1: OUTER = ORGANISATION PROGRESS */}
                    {/* ───────────────────────────────────────────────────────────── */}
                    <g
                        className="transition-all duration-300 cursor-pointer"
                        opacity={hoveredLevel && hoveredLevel !== 'org' ? 0.35 : 1}
                        onMouseEnter={() => setHoveredLevel('org')}
                        onMouseLeave={() => setHoveredLevel(null)}
                    >
                        {/* Track Background */}
                        <path
                            d={orgGeom.pathData}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={STROKE_WIDTH}
                            strokeLinecap="round"
                            className="text-zinc-100 dark:text-zinc-800/80"
                        />
                        {/* Progress Fill (Left -> Right) */}
                        <path
                            d={orgGeom.pathData}
                            fill="none"
                            stroke="url(#org-gradient)"
                            strokeWidth={hoveredLevel === 'org' ? STROKE_WIDTH + 3 : STROKE_WIDTH}
                            strokeLinecap="round"
                            strokeDasharray={orgGeom.circumference}
                            strokeDashoffset={orgGeom.strokeDashoffset}
                            filter={hoveredLevel === 'org' ? 'url(#gauge-glow)' : undefined}
                            style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(0.16, 1, 0.3, 1), stroke-width 200ms ease' }}
                        />
                    </g>

                    {/* ───────────────────────────────────────────────────────────── */}
                    {/* ARC 2: MIDDLE = DEPARTMENT PROGRESS */}
                    {/* ───────────────────────────────────────────────────────────── */}
                    <g
                        className="transition-all duration-300 cursor-pointer"
                        opacity={hoveredLevel && hoveredLevel !== 'dept' ? 0.35 : 1}
                        onMouseEnter={() => setHoveredLevel('dept')}
                        onMouseLeave={() => setHoveredLevel(null)}
                    >
                        {/* Track Background */}
                        <path
                            d={deptGeom.pathData}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={STROKE_WIDTH}
                            strokeLinecap="round"
                            className="text-zinc-100 dark:text-zinc-800/80"
                        />
                        {/* Progress Fill (Left -> Right) */}
                        <path
                            d={deptGeom.pathData}
                            fill="none"
                            stroke="url(#dept-gradient)"
                            strokeWidth={hoveredLevel === 'dept' ? STROKE_WIDTH + 3 : STROKE_WIDTH}
                            strokeLinecap="round"
                            strokeDasharray={deptGeom.circumference}
                            strokeDashoffset={deptGeom.strokeDashoffset}
                            filter={hoveredLevel === 'dept' ? 'url(#gauge-glow)' : undefined}
                            style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(0.16, 1, 0.3, 1), stroke-width 200ms ease' }}
                        />
                    </g>

                    {/* ───────────────────────────────────────────────────────────── */}
                    {/* ARC 3: INNER = EMPLOYEE PROGRESS */}
                    {/* ───────────────────────────────────────────────────────────── */}
                    <g
                        className="transition-all duration-300 cursor-pointer"
                        opacity={hoveredLevel && hoveredLevel !== 'employee' ? 0.35 : 1}
                        onMouseEnter={() => setHoveredLevel('employee')}
                        onMouseLeave={() => setHoveredLevel(null)}
                    >
                        {/* Track Background */}
                        <path
                            d={empGeom.pathData}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={STROKE_WIDTH}
                            strokeLinecap="round"
                            className="text-zinc-100 dark:text-zinc-800/80"
                        />
                        {/* Progress Fill (Left -> Right) */}
                        <path
                            d={empGeom.pathData}
                            fill="none"
                            stroke="url(#emp-gradient)"
                            strokeWidth={hoveredLevel === 'employee' ? STROKE_WIDTH + 3 : STROKE_WIDTH}
                            strokeLinecap="round"
                            strokeDasharray={empGeom.circumference}
                            strokeDashoffset={empGeom.strokeDashoffset}
                            filter={hoveredLevel === 'employee' ? 'url(#gauge-glow)' : undefined}
                            style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(0.16, 1, 0.3, 1), stroke-width 200ms ease' }}
                        />
                    </g>

                    {/* ───────────────────────────────────────────────────────────── */}
                    {/* CENTER READOUT DISPLAY */}
                    {/* ───────────────────────────────────────────────────────────── */}
                    {/* Baseline Horizontal Decorative Divider */}
                    <line
                        x1={CX - 80}
                        y1={CY + 5}
                        x2={CX + 80}
                        y2={CY + 5}
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeDasharray="4 4"
                        className="text-zinc-200 dark:text-zinc-800"
                    />

                    {/* Center Percentage Display */}
                    <text
                        x={CX}
                        y={CY - 78}
                        textAnchor="middle"
                        dominantBaseline="central"
                        className="font-black text-5xl tracking-tight transition-colors duration-300 fill-zinc-900 dark:fill-zinc-50"
                        style={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                        {Math.round(activeMetric.percentage)}%
                    </text>

                    {/* Center Level Title / Scope Label */}
                    <text
                        x={CX}
                        y={CY - 46}
                        textAnchor="middle"
                        dominantBaseline="central"
                        className="text-[12px] font-bold uppercase tracking-wider transition-colors duration-300"
                        fill={activeColor}
                    >
                        {activeMetric.label}
                    </text>

                    {/* Center Task Count Pill Box */}
                    <g transform={`translate(${CX - 65}, ${CY - 30})`}>
                        <rect
                            x="0"
                            y="0"
                            width="130"
                            height="24"
                            rx="12"
                            className="fill-zinc-100 dark:fill-zinc-800/90 stroke-zinc-200 dark:stroke-zinc-700/60"
                            strokeWidth="1"
                        />
                        <text
                            x="65"
                            y="13"
                            textAnchor="middle"
                            dominantBaseline="central"
                            className="text-[11px] font-bold fill-zinc-700 dark:fill-zinc-300"
                            style={{ fontVariantNumeric: 'tabular-nums' }}
                        >
                            {activeMetric.completed} / {activeMetric.total} tasks
                        </text>
                    </g>
                </svg>
            </div>

            {/* ── 3 Interactive Level Legend Cards ─────────────────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3 mt-1 border-t border-zinc-100 dark:border-zinc-800/80">
                {/* 1. Organisation Card (Outer Arc) */}
                <div
                    onMouseEnter={() => setHoveredLevel('org')}
                    onMouseLeave={() => setHoveredLevel(null)}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                        activeLevel === 'org'
                            ? 'bg-indigo-50/80 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-700 shadow-sm ring-1 ring-indigo-500/20'
                            : 'bg-zinc-50/60 dark:bg-zinc-800/40 border-zinc-200/80 dark:border-zinc-700/60 hover:border-zinc-300 dark:hover:border-zinc-600'
                    }`}
                >
                    <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center flex-shrink-0">
                            <Building2 className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-indigo-500 flex-shrink-0" />
                                <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                                    Organisation
                                </span>
                            </div>
                            <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                                Outer Arc • {orgProgress.sublabel || 'Company Rollup'}
                            </div>
                        </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                        <div className="text-sm font-black text-indigo-600 dark:text-indigo-400">
                            {orgProgress.percentage}%
                        </div>
                        <div className="text-[10px] text-zinc-400 dark:text-zinc-500">
                            {orgProgress.completed}/{orgProgress.total}
                        </div>
                    </div>
                </div>

                {/* 2. Department Card (Middle Arc) */}
                <div
                    onMouseEnter={() => setHoveredLevel('dept')}
                    onMouseLeave={() => setHoveredLevel(null)}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                        activeLevel === 'dept'
                            ? 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700 shadow-sm ring-1 ring-emerald-500/20'
                            : 'bg-zinc-50/60 dark:bg-zinc-800/40 border-zinc-200/80 dark:border-zinc-700/60 hover:border-zinc-300 dark:hover:border-zinc-600'
                    }`}
                >
                    <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center flex-shrink-0">
                            <Users className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                                <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                                    Department
                                </span>
                            </div>
                            <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                                Middle Arc • {deptProgress.sublabel || deptProgress.label}
                            </div>
                        </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                        <div className="text-sm font-black text-emerald-600 dark:text-emerald-400">
                            {deptProgress.percentage}%
                        </div>
                        <div className="text-[10px] text-zinc-400 dark:text-zinc-500">
                            {deptProgress.completed}/{deptProgress.total}
                        </div>
                    </div>
                </div>

                {/* 3. Employee Card (Inner Arc) */}
                <div
                    onMouseEnter={() => setHoveredLevel('employee')}
                    onMouseLeave={() => setHoveredLevel(null)}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                        activeLevel === 'employee'
                            ? 'bg-amber-50/80 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700 shadow-sm ring-1 ring-amber-500/20'
                            : 'bg-zinc-50/60 dark:bg-zinc-800/40 border-zinc-200/80 dark:border-zinc-700/60 hover:border-zinc-300 dark:hover:border-zinc-600'
                    }`}
                >
                    <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center flex-shrink-0">
                            <User className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
                                <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                                    Employee
                                </span>
                            </div>
                            <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                                Inner Arc • {employeeProgress.sublabel || employeeProgress.label}
                            </div>
                        </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                        <div className="text-sm font-black text-amber-600 dark:text-amber-400">
                            {employeeProgress.percentage}%
                        </div>
                        <div className="text-[10px] text-zinc-400 dark:text-zinc-500">
                            {employeeProgress.completed}/{employeeProgress.total}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
