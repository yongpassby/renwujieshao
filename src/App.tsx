import { useEffect, useRef, useState } from 'react';
import type Konva from 'konva';
import EditorPanel from './components/EditorPanel';
import ImageCropModal from './components/ImageCropModal';
import MemeCanvas from './components/MemeCanvas';
import { LOCAL_STORAGE_KEY, createDefaultMemeConfig } from './lib/defaultTemplate';
import { copyStageToClipboard, downloadStageImage } from './lib/exportImage';
import type { MemeConfig } from './types';
import localforage from 'localforage';

interface NoticeState {
  type: 'error' | 'success';
  message: string;
}

interface PendingCropState {
  roleId: string;
  imageSrc: string;
}

function createExportFileName(title: string, extension: 'png' | 'jpg') {
  const base = title.trim().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}-]+/gu, '').slice(0, 24) || 'meme';
  return `${base}.${extension}`;
}

async function loadDraft(): Promise<MemeConfig> {
  const defaults = createDefaultMemeConfig();

  if (typeof window === 'undefined') {
    return defaults;
  }

  const raw = await localforage.getItem(LOCAL_STORAGE_KEY);


  try {
    const parsed = raw as MemeConfig;

    if (!parsed?.roles || parsed.roles.length !== 4 || !parsed.settings) {
      return defaults;
    }

    return {
      ...defaults,
      ...parsed,
      settings: {
        ...defaults.settings,
        ...parsed.settings,
      },
      roles: defaults.roles.map((role, index) => ({
        ...role,
        ...parsed.roles[index],
      })),
    };
  } catch {
    return defaults;
  }
}

export default function App() {
  const stageRef = useRef<Konva.Stage | null>(null);
  const [config, setConfig] = useState<MemeConfig>(createDefaultMemeConfig());
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [pendingCrop, setPendingCrop] = useState<PendingCropState | null>(null);

  // Async load logic runs ONCE when component mounts
  useEffect(() => {
    // Create async function inside useEffect (can't make useEffect itself async)
    const fetchDraft = async () => {
      const draftConfig = await loadDraft();
      setConfig(draftConfig); // Update state with the REAL config data
    };

    fetchDraft();
  }, []); // Empty dependency array = run ONLY once on mount

  useEffect(() => {
    const saveToStorage = async () => {
    // NO JSON.stringify NEEDED! localForage stores objects directly
    await localforage.setItem(LOCAL_STORAGE_KEY, config);
  };
  saveToStorage();
  }, [config]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeoutId = window.setTimeout(() => setNotice(null), 3600);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  function updateRoleImage(roleId: string, imageSrc: string, originalImageSrc: string) {
    setConfig((current) => ({
      ...current,
      roles: current.roles.map((role) =>
        role.id === roleId
          ? {
              ...role,
              displayType: 'image',
              imageSrc,
              originalImageSrc,
            }
          : role,
      ),
    }));
  }

  function handleConfigChange(next: MemeConfig) {
    setConfig(next);
  }

  function handleReset() {
    setConfig(createDefaultMemeConfig());
    setNotice({
      type: 'success',
      message: '已恢复默认模板。',
    });
  }

  async function runExport(action: 'png' | 'jpg' | 'copy') {
    setBusyAction(action);
    setNotice(null);

    try {
      if (action === 'png') {
        await downloadStageImage(stageRef.current, 'png', {
          fileName: createExportFileName(config.title, 'png'),
          pixelRatio: 3,
        });
        setNotice({ type: 'success', message: 'PNG 已导出。' });
      } else if (action === 'jpg') {
        await downloadStageImage(stageRef.current, 'jpeg', {
          fileName: createExportFileName(config.title, 'jpg'),
          pixelRatio: 3,
        });
        setNotice({ type: 'success', message: 'JPG 已导出。' });
      } else {
        await copyStageToClipboard(stageRef.current, 3);
        setNotice({ type: 'success', message: '图片已复制到剪贴板。' });
      }
    } catch (error) {
      setNotice({
        type: 'error',
        message:
          error instanceof Error
            ? error.message
            : action === 'copy'
              ? '复制失败，请改用下载按钮。'
              : '图片导出失败',
      });
    } finally {
      setBusyAction(null);
    }
  }

  function handleSelectRoleImage(roleId: string, file: File) {
    const reader = new FileReader();

    reader.onload = () => {
      const result = reader.result;

      if (typeof result !== 'string') {
        setNotice({ type: 'error', message: '图片读取失败，请重试。' });
        return;
      }

      setPendingCrop({
        roleId,
        imageSrc: result,
      });
    };

    reader.onerror = () => {
      setNotice({ type: 'error', message: '图片读取失败，请更换文件。' });
    };

    reader.readAsDataURL(file);
  }

  function handleRecropRoleImage(roleId: string) {
    const targetRole = config.roles.find((role) => role.id === roleId);

    if (!targetRole?.originalImageSrc) {
      setNotice({ type: 'error', message: '当前角色还没有原始图片可供裁剪。' });
      return;
    }

    setPendingCrop({
      roleId,
      imageSrc: targetRole.originalImageSrc,
    });
  }

  return (
    <div className="app-shell">
      <div className="mx-auto flex max-w-[1680px] flex-col gap-6 xl:items-start xl:flex-row">
        <div className="order-2 min-h-0 xl:order-1 xl:w-[440px] xl:min-w-[420px]">
          <EditorPanel
            busyAction={busyAction}
            config={config}
            notice={notice}
            onConfigChange={handleConfigChange}
            onCopy={() => void runExport('copy')}
            onExportJpg={() => void runExport('jpg')}
            onExportPng={() => void runExport('png')}
            onRecropRoleImage={handleRecropRoleImage}
            onReset={handleReset}
            onSelectRoleImage={handleSelectRoleImage}
          />
        </div>

        <div className="order-1 min-h-0 flex-1 self-start xl:order-2">
          <MemeCanvas config={config} stageRef={stageRef} />
        </div>
      </div>

      <ImageCropModal
        imageSrc={pendingCrop?.imageSrc ?? null}
        isOpen={pendingCrop !== null}
        onCancel={() => setPendingCrop(null)}
        onConfirm={(croppedImage) => {
          if (!pendingCrop) {
            return;
          }

          updateRoleImage(pendingCrop.roleId, croppedImage, pendingCrop.imageSrc);
          setPendingCrop(null);
          setNotice({ type: 'success', message: '图片裁剪已应用。' });
        }}
        roleLabel={config.roles.find((role) => role.id === pendingCrop?.roleId)?.title || '当前角色'}
      />
    </div>
  );
}
