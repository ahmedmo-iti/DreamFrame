import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, Play, X, RefreshCw } from 'lucide-react';
import img3dRoom from '../assets/images/regenerated_image_1785313205324.jpg';
import imgMeshKitchen from '../assets/images/regenerated_image_1785313203399.png';
import imgFinalFrame from '../assets/images/regenerated_image_1785387731437.png';

interface LandingScreenProps {
  onProceed: (workflow?: '3d' | 'model' | 'storyboard' | 'shot') => void;
}

export const LandingScreen: React.FC<LandingScreenProps> = ({ onProceed }) => {
  const [isDemoOpen, setIsDemoOpen] = useState(false);
  const [isPlayingDemo, setIsPlayingDemo] = useState(true);

  return (
    <div className="w-full max-w-7xl mx-auto relative min-h-[calc(100vh-120px)] flex flex-col justify-between px-6 py-6 md:py-10 select-none overflow-hidden">
      {/* Deep Violet Ambient Atmospheric Backdrop matching reference photo */}
      <div className="fixed inset-0 -z-20 overflow-hidden pointer-events-none bg-[#040209]">
        {/* Subtle Violet & Purple Atmospheric Glow Spheres */}
        <motion.div
          animate={{
            scale: [1, 1.1, 1],
            opacity: [0.5, 0.7, 0.5],
            x: [0, 15, 0],
          }}
          transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute top-[10%] right-[0%] w-[65vw] h-[65vw] max-w-[850px] max-h-[850px] rounded-full bg-gradient-to-br from-[#581c87]/35 via-[#3b0764]/20 to-transparent blur-[160px]"
        />

        <motion.div
          animate={{
            scale: [1.1, 1, 1.1],
            opacity: [0.4, 0.6, 0.4],
            y: [0, -15, 0],
          }}
          transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
          className="absolute top-[35%] right-[25%] w-[50vw] h-[50vw] max-w-[700px] max-h-[700px] rounded-full bg-gradient-to-tl from-[#6b21a8]/25 via-[#2e1065]/15 to-transparent blur-[140px]"
        />

        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_65%_45%,rgba(76,29,149,0.18)_0%,rgba(15,8,30,0.45)_50%,rgba(4,2,9,0.95)_100%)]" />
      </div>

      {/* Main Hero Container: 2-Column Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center my-auto z-10 py-4">
        {/* Left Column: Hero Typography & Actions */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="lg:col-span-6 xl:col-span-5 text-left"
        >
          {/* Main Brand Title */}
          <h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-7xl xl:text-8xl font-black tracking-tighter text-white uppercase leading-none mb-4 filter drop-shadow-[0_4px_25px_rgba(0,0,0,0.85)]">
            DREAMFRAME
          </h1>

          {/* Dynamic Tagline */}
          <div className="text-2xl sm:text-3xl md:text-4xl lg:text-[36px] xl:text-[40px] font-bold tracking-tight text-white leading-tight mb-5 drop-shadow-[0_3px_15px_rgba(0,0,0,0.9)] space-y-1">
            <p>Create in 3D.</p>
            <p>Craft cinematic shots.</p>
          </div>

          {/* Subtitle Paragraph - High Contrast */}
          <div className="text-sm sm:text-base text-white/90 font-normal leading-relaxed mb-8 max-w-lg drop-shadow-[0_2px_10px_rgba(0,0,0,0.95)] space-y-1">
            <p>Turn imagery into scenes, surfaces, and environments.</p>
            <p>Generate production-ready shots with tools built for filmmakers.</p>
          </div>

          {/* Call To Action Buttons */}
          <div className="flex items-center gap-4.5 mb-4 flex-wrap">
            {/* Primary CTA Button */}
            <button
              onClick={() => onProceed()}
              className="px-6 py-2.5 sm:px-7 sm:py-3 rounded-full bg-white text-black font-bold text-sm sm:text-base hover:bg-white/95 hover:scale-[1.03] active:scale-95 transition-all duration-300 flex items-center justify-center gap-2 shadow-[0_8px_24px_rgba(255,255,255,0.18)] cursor-pointer group"
            >
              <span>Start creating</span>
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>

            {/* Secondary Watch Demo Button */}
            <button
              onClick={() => setIsDemoOpen(true)}
              className="group flex items-center gap-2.5 text-white font-semibold text-sm sm:text-base hover:text-white/90 transition-all cursor-pointer"
            >
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white/10 border border-white/30 backdrop-blur-md flex items-center justify-center group-hover:bg-white/20 group-hover:border-white/60 group-hover:scale-105 transition-all shadow-xl">
                <Play className="w-3.5 h-3.5 fill-current text-white ml-0.5" />
              </div>
              <span>Watch demo</span>
            </button>
          </div>
        </motion.div>

        {/* Right Column: Floating Visual Showcase */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="lg:col-span-6 xl:col-span-7 flex items-center justify-center lg:justify-end gap-5 sm:gap-6 md:gap-8 pt-4 lg:pt-0"
        >
          {/* Floating Image 1: 3D Clay Mesh */}
          <motion.div
            animate={{ y: [0, -14, 0] }}
            transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut' }}
            className="flex flex-col items-center group relative z-10"
          >
            <motion.img
              animate={{ scale: [1, 1.02, 1] }}
              transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut' }}
              src={imgMeshKitchen}
              alt="3D Blockout Mesh"
              className="w-[155px] sm:w-[220px] md:w-[260px] lg:w-[275px] xl:w-[310px] aspect-square object-cover rounded-2xl sm:rounded-3xl filter grayscale contrast-125 brightness-110 group-hover:scale-105 transition-transform duration-700"
            />
          </motion.div>

          {/* Floating Image 2: Final Illuminated Render */}
          <motion.div
            animate={{ y: [0, -12, 0] }}
            transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut', delay: 1.5 }}
            className="flex flex-col items-center group relative z-10"
          >
            <motion.img
              animate={{ scale: [1, 1.02, 1] }}
              transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut', delay: 1.5 }}
              src={imgFinalFrame}
              alt="Final Rendered Cinematic Frame"
              className="w-[155px] sm:w-[220px] md:w-[260px] lg:w-[275px] xl:w-[310px] aspect-square object-cover rounded-2xl sm:rounded-3xl group-hover:scale-105 transition-transform duration-700"
            />
          </motion.div>
        </motion.div>
      </div>

      {/* Bottom Features List & Copyright Bar - Left Aligned with High Opacity */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.6 }}
        className="z-10 mt-auto pt-4 pb-0 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs sm:text-sm text-white font-medium tracking-wide drop-shadow-[0_2px_8px_rgba(0,0,0,0.95)]"
      >
        <div className="flex items-center justify-start gap-3 sm:gap-4 flex-wrap text-white">
          <span>3D Creation</span>
          <span className="text-white/70">•</span>
          <span>Scene Building</span>
          <span className="text-white/70">•</span>
          <span>Cinematic Shots</span>
          <span className="text-white/70">•</span>
          <span>Camera & Lighting</span>
          <span className="text-white/70">•</span>
          <span>Production Export</span>
        </div>

        <div className="text-[11px] font-mono text-white/80 tracking-widest uppercase">
          © {new Date().getFullYear()} DREAMFRAME. ALL RIGHTS RESERVED.
        </div>
      </motion.div>

      {/* Interactive Cinematic Demo Modal Overlay */}
      <AnimatePresence>
        {isDemoOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/85 backdrop-blur-xl flex items-center justify-center p-4 sm:p-8"
            onClick={() => setIsDemoOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              transition={{ duration: 0.3 }}
              className="relative w-full max-w-4xl rounded-2xl bg-neutral-900 border border-white/20 overflow-hidden shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-neutral-950/80">
                <div className="flex items-center gap-2 font-mono text-xs text-white/80">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  <span className="font-bold">DREAMFRAME DEMO SHOWCASE</span>
                  <span className="text-white/30">•</span>
                  <span className="text-white/50">3D GAUSSIAN SPLAT ENGINE</span>
                </div>
                <button
                  onClick={() => setIsDemoOpen(false)}
                  className="p-1.5 rounded-full hover:bg-white/10 text-white/70 hover:text-white transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Video Showcase Viewport */}
              <div className="relative aspect-video bg-black overflow-hidden group">
                <img
                  src={img3dRoom}
                  alt="DreamFrame Demo Scene"
                  className={`w-full h-full object-cover transition-transform duration-1000 ${
                    isPlayingDemo ? 'scale-110 animate-pulse' : 'scale-100'
                  }`}
                />

                {/* Simulated Camera Trajectory & Splat Wireframe Overlay */}
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <svg className="w-full h-full opacity-60" viewBox="0 0 800 450" fill="none">
                    <path
                      d="M 100 350 C 250 150, 400 400, 500 200 C 600 50, 700 300, 750 150"
                      stroke="#818cf8"
                      strokeWidth="2"
                      strokeDasharray="6 6"
                      fill="none"
                    />
                    <circle cx="500" cy="200" r="8" fill="#c084fc" className="animate-ping" />
                  </svg>
                </div>

                {/* Controls overlay */}
                <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between px-4 py-3 rounded-xl bg-black/60 border border-white/15 backdrop-blur-md">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setIsPlayingDemo(!isPlayingDemo)}
                      className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
                    >
                      {isPlayingDemo ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
                    </button>
                    <span className="text-xs font-mono text-white/80">
                      {isPlayingDemo ? 'PLAYING 3D TRAJECTORY PREVIEW' : 'PAUSED'}
                    </span>
                  </div>

                  <button
                    onClick={() => {
                      setIsDemoOpen(false);
                      onProceed();
                    }}
                    className="px-4 py-1.5 rounded-lg bg-white text-black text-xs font-bold hover:bg-white/90 transition-colors cursor-pointer"
                  >
                    LAUNCH ENGINE →
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
