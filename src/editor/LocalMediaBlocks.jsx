import { useState } from "react";
import { createAudioBlockConfig, createImageBlockConfig, createVideoBlockConfig, audioParse, imageParse, videoParse } from "@blocknote/core";
import { AudioToExternalHTML, ImageToExternalHTML, VideoToExternalHTML, createReactBlockSpec, FileBlockWrapper, ResizableFileBlockWrapper, useResolveUrl } from "@blocknote/react";
import IconPhoto from "@tabler/icons-react/dist/esm/icons/IconPhoto.mjs";
import IconVolume from "@tabler/icons-react/dist/esm/icons/IconVolume.mjs";
import IconVideo from "@tabler/icons-react/dist/esm/icons/IconVideo.mjs";

function MediaPreview({ block, kind }) {
  const resolved = useResolveUrl(block.props.url);
  const [failed, setFailed] = useState(null);
  if (resolved.loadingState === "loading") return <p className="life-media-state" role="status">正在打开本地附件…</p>;
  if (resolved.loadingState === "error" || failed === resolved.downloadUrl) return <p className="life-media-state" role="status">{block.props.name ? `${block.props.name} · ` : ""}附件文件在本机不可用，请重新选择本地文件。</p>;
  const shared = { src: resolved.downloadUrl, contentEditable: false, draggable: false, onError: () => setFailed(resolved.downloadUrl) };
  if (kind === "image") return <img crossOrigin="anonymous" {...shared} className="bn-visual-media" alt={block.props.name || ""} width={block.props.previewWidth} />;
  if (kind === "audio") return <audio {...shared} className="bn-audio" controls />;
  return <video {...shared} className="bn-visual-media" width={block.props.previewWidth} controls />;
}

function LocalMediaBlock(props) {
  const kind = props.block.type;
  const Icon = kind === "image" ? IconPhoto : kind === "audio" ? IconVolume : IconVideo;
  const Wrapper = kind === "audio" ? FileBlockWrapper : ResizableFileBlockWrapper;
  return <Wrapper {...props} buttonIcon={<Icon size={24} />}><MediaPreview block={props.block} kind={kind} /></Wrapper>;
}

export const localMediaBlockSpecs = {
  image: createReactBlockSpec(createImageBlockConfig, (config) => ({ meta: { fileBlockAccept: ["image/*"] }, render: LocalMediaBlock, parse: imageParse(config), toExternalHTML: ImageToExternalHTML, runsBefore: ["file"] }))(),
  audio: createReactBlockSpec(createAudioBlockConfig, (config) => ({ meta: { fileBlockAccept: ["audio/*"] }, render: LocalMediaBlock, parse: audioParse(config), toExternalHTML: AudioToExternalHTML, runsBefore: ["file"] }))(),
  video: createReactBlockSpec(createVideoBlockConfig, (config) => ({ meta: { fileBlockAccept: ["video/*"] }, render: LocalMediaBlock, parse: videoParse(config), toExternalHTML: VideoToExternalHTML, runsBefore: ["file"] }))(),
};
