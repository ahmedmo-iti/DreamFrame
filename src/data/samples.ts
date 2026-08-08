import { AssetRecord, ProjectItem, SampleMedia } from '../types';
import img3dRoom from '../assets/images/regenerated_image_1785313205324.jpg';
import imgMeshKitchen from '../assets/images/regenerated_image_1785313203399.png';
import img3dModel from '../assets/images/regenerated_image_1785378547653.png';
import imgHdri from '../assets/images/regenerated_image_1785378548313.png';
import imgStoryboard from '../assets/images/regenerated_image_1785378549595.jpg';
import imgMesh from '../assets/images/regenerated_image_1785393677179.jpg';

export const INITIAL_ASSETS: AssetRecord[] = [];
export const INITIAL_PROJECTS: ProjectItem[] = [];

export const SAMPLE_PANORAMAS: SampleMedia[] = [
  {
    id: 'pano-indoor-room',
    title: 'Detective Study Interior',
    subtitle: 'Bundled local interior reference',
    type: 'panorama',
    url: img3dRoom,
    previewUrl: img3dRoom,
  },
  {
    id: 'pano-architecture',
    title: 'Architecture Reference',
    subtitle: 'Bundled local structure reference',
    type: 'panorama',
    url: imgMeshKitchen,
    previewUrl: imgMeshKitchen,
  },
  {
    id: 'pano-lighting',
    title: 'Lighting Environment',
    subtitle: 'Bundled local lighting reference',
    type: 'panorama',
    url: imgHdri,
    previewUrl: imgHdri,
  },
];

export const SAMPLE_PERFORMERS: SampleMedia[] = [
  {
    id: 'talent-model',
    title: 'Model Reference',
    subtitle: 'Bundled local object reference',
    type: 'performer',
    url: img3dModel,
    previewUrl: img3dModel,
  },
  {
    id: 'talent-storyboard',
    title: 'Storyboard Reference',
    subtitle: 'Bundled local storyboard style reference',
    type: 'performer',
    url: imgStoryboard,
    previewUrl: imgStoryboard,
  },
  {
    id: 'talent-mesh',
    title: 'Mesh Reference',
    subtitle: 'Bundled local geometry reference',
    type: 'performer',
    url: imgMesh,
    previewUrl: imgMesh,
  },
];
