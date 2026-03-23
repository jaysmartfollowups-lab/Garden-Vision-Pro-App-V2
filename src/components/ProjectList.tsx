import React, { useState, useEffect } from 'react';
import { 
  collection, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  deleteDoc,
  doc,
  serverTimestamp
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { signInAnonymously } from 'firebase/auth';
import { Project } from '../types';
import { handleFirestoreError, OperationType } from '../lib/firebase-errors';
import { 
  Plus, 
  MapPin, 
  Calendar, 
  ChevronRight, 
  Search, 
  LogOut, 
  User,
  Trees,
  LayoutGrid,
  List as ListIcon,
  Trash2,
  AlertCircle,
  Loader2,
  Sparkles
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

interface ProjectListProps {
  onSelectProject: (project: Project) => void;
}

const getUid = () => auth.currentUser?.uid ?? 'local-dev';

export function ProjectList({ onSelectProject }: ProjectListProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newHouseNumber, setNewHouseNumber] = useState('');
  const [newPostcode, setNewPostcode] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);


  useEffect(() => {
    let snapUnsub: (() => void) | null = null;

    const authUnsub = auth.onAuthStateChanged((user) => {
      if (!user) return;

      const q = query(
        collection(db, 'projects'),
        where('ownerId', '==', user.uid),
        orderBy('updatedAt', 'desc')
      );

      snapUnsub = onSnapshot(q, (snapshot) => {
        const projectsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Project[];
        setProjects(projectsData);
        setError(null);
      }, (err) => {
        console.warn('Projects snapshot error:', err.message);
        setError('Failed to load projects. Please check your connection.');
      });
    });

    return () => {
      authUnsub();
      if (snapUnsub) snapUnsub();
    };
  }, []);

  const [formError, setFormError] = useState<string | null>(null);

  const handleAddProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || isSubmitting) return;

    setIsSubmitting(true);
    setFormError(null);

    try {
      // Ensure we have an authenticated user before writing
      if (!auth.currentUser) {
        await signInAnonymously(auth);
      }

      const fullAddress = [newHouseNumber, newPostcode].filter(Boolean).join(', ');
      let lat = null, lng = null;
      if (fullAddress) {
        try {
          const geoRes = await fetch(`/api/google/geocode?address=${encodeURIComponent(fullAddress)}`);
          if (geoRes.ok) {
            const geoData = await geoRes.json();
            lat = geoData.lat ?? null;
            lng = geoData.lng ?? null;
          }
        } catch {
          // Geocoding failed — continue without lat/lng
        }
      }

      const uid = auth.currentUser?.uid ?? 'local-dev';
      await addDoc(collection(db, 'projects'), {
        name: newName,
        address: fullAddress,
        lat,
        lng,
        ownerId: uid,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      setNewName('');
      setNewHouseNumber('');
      setNewPostcode('');
      setIsAdding(false);
    } catch (err: any) {
      console.error('Create project error:', err);
      setFormError(err?.message ?? 'Failed to create project. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSeedProject = async () => {
    if (isSeeding) return;
    setIsSeeding(true);
    setError(null);

    try {
      // Seed a project with real coordinates (Googleplex)
      await addDoc(collection(db, 'projects'), {
        name: "Sample: The Googleplex Garden",
        address: "1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA",
        lat: 37.422388,
        lng: -122.084106,
        ownerId: getUid(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'projects');
      setError('Failed to seed sample project.');
    } finally {
      setIsSeeding(false);
    }
  };

  const handleDeleteProject = async () => {
    if (!projectToDelete) return;
    
    try {
      await deleteDoc(doc(db, 'projects', projectToDelete));
      setProjectToDelete(null);
    } catch (error) {
      console.error('Failed to delete project', error);
    }
  };

  const filteredProjects = projects.filter(p => 
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.address?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[#FDFCFB] flex flex-col">
      {/* Sidebar Navigation (Desktop) */}
      <div className="flex flex-1">
        <aside className="hidden lg:flex w-64 bg-white border-r border-zinc-100 flex-col p-6">
          <div className="flex items-center gap-3 mb-12">
            <div className="w-10 h-10 bg-emerald-500 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-200">
              <Trees className="text-white" size={24} />
            </div>
            <h1 className="font-black text-xl tracking-tight text-zinc-900">GardenVision</h1>
          </div>

          <nav className="space-y-2 flex-1">
            <button className="w-full flex items-center gap-3 px-4 py-3 bg-emerald-50 text-emerald-600 rounded-xl font-bold text-sm transition-all">
              <LayoutGrid size={18} />
              Projects
            </button>
            <button className="w-full flex items-center gap-3 px-4 py-3 text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600 rounded-xl font-bold text-sm transition-all">
              <Calendar size={18} />
              Schedule
            </button>
            <button className="w-full flex items-center gap-3 px-4 py-3 text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600 rounded-xl font-bold text-sm transition-all">
              <User size={18} />
              Clients
            </button>
          </nav>

          <div className="pt-6 border-t border-zinc-100">
            <button 
              onClick={() => auth.signOut()}
              className="w-full flex items-center gap-3 px-4 py-3 text-zinc-400 hover:text-red-500 transition-all font-bold text-sm"
            >
              <LogOut size={18} />
              Sign Out
            </button>
          </div>
        </aside>

        <main className="flex-1 p-6 lg:p-12 max-w-7xl mx-auto w-full">
          {/* Header */}
          <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
            <div>
              <h2 className="text-3xl font-black text-zinc-900 tracking-tight">Your Projects</h2>
              <p className="text-zinc-400 font-medium mt-1">Manage and transform your client gardens</p>
            </div>
            <div className="flex flex-col md:flex-row md:items-center gap-4">
              <button 
                onClick={handleSeedProject}
                disabled={isSeeding}
                className="px-6 py-4 bg-emerald-50 text-emerald-600 rounded-2xl font-bold text-sm uppercase tracking-widest hover:bg-emerald-100 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
              >
                {isSeeding ? <Loader2 size={20} className="animate-spin" /> : <Sparkles size={20} />}
                Seed Sample
              </button>
              <button 
                onClick={() => setIsAdding(true)}
                className="bg-zinc-900 text-white px-6 py-4 rounded-2xl font-bold text-sm uppercase tracking-widest shadow-xl hover:bg-black transition-all flex items-center justify-center gap-3"
              >
                <Plus size={20} />
                New Project
              </button>
            </div>
          </header>

          {error && (
            <div className="mb-8 p-4 bg-red-50 border-2 border-red-100 rounded-2xl flex items-center gap-3 text-red-600 font-medium">
              <AlertCircle size={20} />
              {error}
            </div>
          )}

          {/* Search & Filters */}
          <div className="flex flex-col md:flex-row items-center gap-4 mb-8">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={18} />
              <input 
                type="text" 
                placeholder="Search projects by name or address..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-12 pr-4 py-4 bg-white border-2 border-zinc-100 rounded-2xl focus:border-emerald-500 focus:ring-0 transition-all font-medium text-zinc-800"
              />
            </div>
            <div className="flex bg-white border-2 border-zinc-100 rounded-2xl p-1">
              <button 
                onClick={() => setViewMode('grid')}
                className={cn("p-2 rounded-xl transition-all", viewMode === 'grid' ? "bg-zinc-100 text-zinc-900" : "text-zinc-400")}
              >
                <LayoutGrid size={20} />
              </button>
              <button 
                onClick={() => setViewMode('list')}
                className={cn("p-2 rounded-xl transition-all", viewMode === 'list' ? "bg-zinc-100 text-zinc-900" : "text-zinc-400")}
              >
                <ListIcon size={20} />
              </button>
            </div>
          </div>

          {/* Project Grid/List */}
          {filteredProjects.length > 0 ? (
            <div className={cn(
              "grid gap-6",
              viewMode === 'grid' ? "grid-cols-1 md:grid-cols-2 xl:grid-cols-3" : "grid-cols-1"
            )}>
              {filteredProjects.map((project, idx) => (
                <motion.button
                  key={project.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  onClick={() => onSelectProject(project)}
                  className={cn(
                    "bg-white border-2 border-zinc-100 rounded-3xl p-6 text-left transition-all group hover:border-emerald-500 hover:shadow-2xl hover:shadow-emerald-100/50",
                    viewMode === 'list' && "flex items-center justify-between"
                  )}
                >
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-zinc-50 rounded-2xl flex items-center justify-center text-zinc-400 group-hover:bg-emerald-50 group-hover:text-emerald-500 transition-colors">
                      <Trees size={24} />
                    </div>
                    <div>
                      <h3 className="font-bold text-zinc-900 group-hover:text-emerald-600 transition-colors">{project.name}</h3>
                      <div className="flex items-center gap-2 text-zinc-400 text-xs mt-1 font-medium">
                        <MapPin size={12} />
                        {project.address || 'No address provided'}
                      </div>
                    </div>
                  </div>
                  <div className={cn(
                    "flex items-center gap-4",
                    viewMode === 'grid' ? "mt-6 pt-6 border-t border-zinc-50" : ""
                  )}>
                    <div className="flex-1">
                      <p className="text-[10px] uppercase tracking-widest font-bold text-zinc-300">Last Updated</p>
                      <p className="text-xs font-bold text-zinc-500 mt-0.5">
                        {new Date(project.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setProjectToDelete(project.id);
                        }}
                        className="w-8 h-8 rounded-full bg-zinc-50 flex items-center justify-center text-zinc-300 hover:bg-red-50 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100"
                        title="Delete Project"
                      >
                        <Trash2 size={14} />
                      </button>
                      <div className="w-8 h-8 rounded-full bg-zinc-50 flex items-center justify-center text-zinc-400 group-hover:bg-emerald-500 group-hover:text-white transition-all">
                        <ChevronRight size={16} />
                      </div>
                    </div>
                  </div>
                </motion.button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="w-20 h-20 bg-zinc-50 rounded-full flex items-center justify-center text-zinc-200 mb-6">
                <Trees size={40} />
              </div>
              <h3 className="text-xl font-bold text-zinc-900">No projects found</h3>
              <p className="text-zinc-400 mt-2 max-w-xs mb-8">Start by creating your first landscaping project or use a sample project to explore.</p>
              <button 
                onClick={handleSeedProject}
                disabled={isSeeding}
                className="px-8 py-4 bg-emerald-500 text-white rounded-2xl font-bold text-sm uppercase tracking-widest shadow-lg shadow-emerald-100 hover:bg-emerald-600 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
              >
                {isSeeding ? <Loader2 size={20} className="animate-spin" /> : <Sparkles size={20} />}
                Generate Sample Project
              </button>
            </div>
          )}
        </main>
      </div>

      {/* Add Project Modal */}
      <AnimatePresence>
        {isAdding && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { setIsAdding(false); setFormError(null); }}
              className="absolute inset-0 bg-zinc-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl p-8"
            >
              <h3 className="text-2xl font-black text-zinc-900 tracking-tight mb-6">New Project</h3>
              {formError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2 text-red-600 text-sm font-medium">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  {formError}
                </div>
              )}
              <form onSubmit={handleAddProject} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 ml-1">Client Name</label>
                  <input 
                    autoFocus
                    type="text" 
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. The Smith Residence"
                    className="w-full px-4 py-4 bg-zinc-50 border-2 border-zinc-50 rounded-2xl focus:bg-white focus:border-emerald-500 focus:ring-0 transition-all font-medium"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 ml-1">House Number & Street</label>
                  <input
                    type="text"
                    value={newHouseNumber}
                    onChange={(e) => setNewHouseNumber(e.target.value)}
                    placeholder="e.g. 15 Andrew Road"
                    className="w-full px-4 py-4 bg-zinc-50 border-2 border-zinc-50 rounded-2xl focus:bg-white focus:border-emerald-500 focus:ring-0 transition-all font-medium"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 ml-1">Postcode</label>
                  <input
                    type="text"
                    value={newPostcode}
                    onChange={(e) => setNewPostcode(e.target.value.toUpperCase())}
                    placeholder="e.g. B71 3QG"
                    className="w-full px-4 py-4 bg-zinc-50 border-2 border-zinc-50 rounded-2xl focus:bg-white focus:border-emerald-500 focus:ring-0 transition-all font-medium"
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <button 
                    type="button"
                    onClick={() => setIsAdding(false)}
                    className="flex-1 py-4 text-zinc-400 font-bold text-sm uppercase tracking-widest hover:text-zinc-600 transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 py-4 bg-emerald-500 text-white rounded-2xl font-bold text-sm uppercase tracking-widest shadow-lg shadow-emerald-200 hover:bg-emerald-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="animate-spin" size={18} />
                        Creating...
                      </>
                    ) : 'Create'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {projectToDelete && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setProjectToDelete(null)}
              className="absolute inset-0 bg-zinc-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl p-8 text-center"
            >
              <div className="w-16 h-16 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Trash2 size={32} />
              </div>
              <h3 className="text-xl font-black text-zinc-900 tracking-tight mb-2">Delete Project?</h3>
              <p className="text-zinc-500 text-sm mb-8">This will permanently remove the project and all associated garden designs.</p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setProjectToDelete(null)}
                  className="flex-1 py-4 text-zinc-400 font-bold text-sm uppercase tracking-widest hover:text-zinc-600 transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleDeleteProject}
                  className="flex-1 py-4 bg-red-500 text-white rounded-2xl font-bold text-sm uppercase tracking-widest shadow-lg shadow-red-200 hover:bg-red-600 transition-all"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
