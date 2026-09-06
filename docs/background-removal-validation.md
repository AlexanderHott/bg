# Background removal validation

The adapter fixtures compare normalized model inputs and RGBA outputs against the
[first-party ONNX notebook](https://github.com/ZhengPeng7/BiRefNet/blob/ebcc0bc8ec7fe919cec829f2dea656b3078acddc/tutorials/BiRefNet_pth2onnx.ipynb)
and [inference notebook](https://github.com/ZhengPeng7/BiRefNet/blob/ebcc0bc8ec7fe919cec829f2dea656b3078acddc/tutorials/BiRefNet_inference.ipynb).
The fixtures cover enlargement, reduction, EXIF rotation, and source alpha. Inference is stubbed
with fixed logits so these tests isolate preprocessing and postprocessing. They do not establish
numerical equivalence between Python and Node inference engines.

The RGB comparison permits two byte levels of resampling error after normalization. Output RGB
must match exactly; alpha may differ by at most two byte levels. The adapter uses Pillow's pixel
center convention, bilinear input resizing, bicubic mask resizing, and uint8 mask conversion.
Sharp decodes and encodes images. A small separable resampler handles the alignment differences
that failed these fixtures with Sharp's resize operation.

Regenerate fixtures with `src/modules/backgroundRemoval/fixtures/generate_reference.py` using
Pillow 12.3.0, NumPy 2.5.2, PyTorch 2.14.0+cpu, and torchvision 0.29.0+cpu. Run them with
`vp test --run src/modules/backgroundRemoval/modelAdapter.test.ts`.

## Runtime measurements

`benchmarks/background-removal.ts` fixes three images from the existing AIM benchmark corpus by
filename and SHA-256: a portrait, an animal, and a transparent object. It checks the pinned model
checksum through the production adapter. The images are external fixtures, not vendored here.

Run `vp run benchmark:background-removal MODEL_PATH CORPUS_DIRECTORY OUTPUT_DIRECTORY`.
Use an isolated 8 GiB container with swap disabled and networking disabled. The output directory
contains PNGs for visual review and a `results.json` report. Only the first inference in the first
pass is cold; `coldStartMs` includes model loading and that inference. The repeat pass measures
warm inference. Retained RSS is sampled after explicit JavaScript garbage collection; peak RSS
includes native inference allocations. Filesystem caches are not cleared.

The recorded September 6 run on an AMD Ryzen 7 7840U used Node 26.3.0 and the pinned model.
Cold startup plus the first output took 9.76 seconds. Repeated outputs took 6.03 to 6.70 seconds.
Peak RSS was 6.84 GiB and retained RSS ended at 0.70 GiB. All six outputs had the input dimensions;
the process completed without a crash under the 8 GiB limit. Raw measurements are in
`benchmarks/background-removal-results.json`.

This small corpus does not establish behavior at the 64-megapixel limit or cover every supported
format. Human review of output quality remains an outstanding release gate.
