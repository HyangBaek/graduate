// src/presentation/containers/GazeTrackingContainer.tsx

import {
    useEffect,
    useRef,
} from 'react'

import {
    useFaceTracking,
} from '@/presentation/hooks/useFaceTracking'

import {
    useGazeWorker,
} from '@/presentation/hooks/useGazeWorker'

export function GazeTrackingContainer() {
    const videoRef =
        useRef<HTMLVideoElement | null>(
            null,
        )

    const {
        start,
    } = useFaceTracking()

    const {
        process,
    } = useGazeWorker()

    useEffect(() => {
        const video =
            videoRef.current

        if (!video) {
            return
        }

        navigator.mediaDevices
            .getUserMedia({
                video: {
                    facingMode: 'user',
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                },
            })
            .then((stream) => {
                video.srcObject = stream

                return video.play()
            })
            .then(async () => {
                await start(
                    video,

                    (
                        landmarks,
                    ) => {
                        console.log('[Container] process send', landmarks,)

                        const primaryFace =
                            landmarks[0]

                        if (!primaryFace) {
                            return
                        }

                        process({
                            landmarks: primaryFace.points,

                            timestamp:
                                performance.now(),

                            screen: {
                                width:
                                    window.innerWidth,

                                height:
                                    window.innerHeight,
                            },

                            dwellRegion: {
                                type: 'rect',

                                left: 0,
                                top: 0,

                                right:
                                    window.innerWidth,

                                bottom:
                                    window.innerHeight,
                            },
                        })
                    },
                )
            })
    }, [
        process,
        start,
    ])

    return (
        <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            style={{
                position: 'fixed',
                width: 240,
                right: 16,
                bottom: 16,
                zIndex: 9999,
            }}
        />
    )
}
