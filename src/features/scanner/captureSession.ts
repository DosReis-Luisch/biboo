import { createId } from '../../app/secureContext'
import type { BookPage, PageRole, PreparedPageImage } from '../pages/page'

type Prepare = (file: File) => Promise<PreparedPageImage>
type Save = (image: PreparedPageImage, role: PageRole, captureId: string) => Promise<BookPage>
export type CaptureStage = 'capturing' | 'processing' | 'saving'
interface PendingCapture { id: string; role: PageRole; file?: File; image?: PreparedPageImage }

// One in-flight photograph, one retry slot, no queue of full-resolution images.
export class CaptureSession {
  private pending?: PendingCapture
  private working = false
  private prepare: Prepare
  private save: Save
  constructor(prepare: Prepare, save: Save) { this.prepare = prepare; this.save = save }
  get hasPending() { return !!this.pending }

  async capture(takePhoto: () => Promise<File>, role: PageRole, progress: (stage: CaptureStage) => void) {
    if (this.working) throw new Error('Wait for the current photograph to finish saving.')
    if (this.pending) throw new Error('Retry or discard the unsaved photograph before taking another.')
    this.working = true
    try {
      const id = createId()
      progress('capturing')
      const file = await takePhoto()
      this.pending = { id, file, role }
      return await this.persist(progress)
    } finally { this.working = false }
  }

  async retry(progress: (stage: CaptureStage) => void) {
    if (this.working) throw new Error('Wait for the current photograph to finish saving.')
    if (!this.pending) throw new Error('There is no unsaved photograph to retry.')
    this.working = true
    try { return await this.persist(progress) } finally { this.working = false }
  }

  discard() {
    if (this.working) throw new Error('Wait for the current photograph to finish saving.')
    this.pending = undefined
  }

  private async persist(progress: (stage: CaptureStage) => void) {
    const pending = this.pending
    if (!pending) throw new Error('The capture is unavailable.')
    if (!pending.image && pending.file) {
      progress('processing')
      pending.image = await this.prepare(pending.file)
      pending.file = undefined
    }
    if (!pending.image) throw new Error('The captured image is unavailable.')
    progress('saving')
    const page = await this.save(pending.image, pending.role, pending.id)
    this.pending = undefined // Only after the repository transaction commits.
    return page
  }
}
