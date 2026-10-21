export type ImageSize = '1024x1024' | '1024x1536' | '1536x1024'

export type ImageGenerationRequest = {
  prompt: string
  size: ImageSize
}

export type ImageGenerator = {
  generate(input: ImageGenerationRequest): Promise<string>
}
