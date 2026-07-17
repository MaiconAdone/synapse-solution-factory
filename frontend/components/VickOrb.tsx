"use client";

import Image from "next/image";

type VickOrbProps = {
  speaking: boolean;
  thinking: boolean;
};

export default function VickOrb({ speaking, thinking }: VickOrbProps) {
  const state = speaking ? "speaking" : thinking ? "thinking" : "idle";

  return (
    <div className={`vick-avatar ${state}`}>
      <Image
        alt="Vick, assistente virtual do Synapse"
        className="vick-avatar-image"
        height={672}
        priority
        src="/vick-avatar.png"
        width={688}
      />
    </div>
  );
}
