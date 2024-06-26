"use client";

import { useState, useEffect, ChangeEvent } from "react";
import { ZKEdDSAEventTicketPCDPackage } from "@pcd/zk-eddsa-event-ticket-pcd";
import { zuAuthPopup } from "@pcd/zuauth";
import type { NextPage } from "next";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth";
import { isETHBerlinPublicKey } from "~~/utils/scaffold-eth/pcd";
import { ETHBERLIN_ZUAUTH_CONFIG } from "~~/utils/zupassConstants";
import { TfheCompactPublicKey } from "tfhe";
import { encrypt, initializeTfhe, loadPublicKey } from "~~/utils/tfhe";

const BASE_URL = "http://localhost:8000";
const PUBLIC_KEY_PATH = `${BASE_URL}/public-key`;
const VOTE_PATH = `${BASE_URL}/vote`;

// Get a valid event id from { supportedEvents } from "zuauth" or https://api.zupass.org/issue/known-ticket-types
const fieldsToReveal = {
  revealAttendeeEmail: true,
  revealEventId: true,
  revealProductId: true,
};

const Home: NextPage = () => {
  const [verifiedFrontend, setVerifiedFrontend] = useState(false);
  const [verifiedBackend, setVerifiedBackend] = useState(false);
  const [pcd, setPcd] = useState<string>();
  const [publicKey, setPublicKey] = useState<TfheCompactPublicKey | null>(null);
  const [inputValues, setInputValues] = useState({ project1: 0, project2: 0, project3: 0 });

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>, project: string) => {
    const value = Number(e.target.value);
    if (!isNaN(value)) {
      setInputValues({
        ...inputValues,
        [project]: value,
      });
    }
  };

  useEffect(() => {
    (async () => {
      console.log("Initializing TFHE...");
      await initializeTfhe();
      console.log("Done!");

      const key = await loadPublicKey(PUBLIC_KEY_PATH);
      setPublicKey(key);
    })();
  }, []);

  const handleClick = async (votes: bigint[]) => {
    console.log("Votes: ", votes);
    if (publicKey) {
      console.log("Encrypting...");
      const votesEncrypted = votes.map(vote => encrypt(vote, publicKey));
      console.log("Serializing...");
      const votesSerialized = votesEncrypted.map(vote => Array.from(vote.serialize()));

      const body = JSON.stringify({ votes: votesSerialized, pcd: pcd });
      console.log(body);
      const response = await fetch(VOTE_PATH, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body,
      });
      console.log("Server response: ", response);
    }
  };

  const getProof = async () => {
    const result = await zuAuthPopup({ fieldsToReveal, watermark: "123", config: ETHBERLIN_ZUAUTH_CONFIG });
    if (result.type === "pcd") {
      // console.log("PCD object: ", JSON.parse(JSON.parse(result.pcdStr).pcd));
      setPcd(JSON.parse(result.pcdStr).pcd);
    } else {
      notification.error("Failed to parse PCD");
    }
  };

  const verifyProofFrontend = async () => {
    if (!pcd) {
      notification.error("No PCD found!");
      return;
    }

    const deserializedPCD = await ZKEdDSAEventTicketPCDPackage.deserialize(pcd);

    if (!(await ZKEdDSAEventTicketPCDPackage.verify(deserializedPCD))) {
      notification.error(`[ERROR Frontend] ZK ticket PCD is not valid`);
      return;
    }

    if (!isETHBerlinPublicKey(deserializedPCD.claim.signer)) {
      notification.error(`[ERROR Frontend] PCD is not signed by ETHBerlin`);
      return;
    }

    setVerifiedFrontend(true);
    notification.success(
      <>
        <p className="font-bold m-0">Frontend Verified!</p>
        <p className="m-0">
          The proof has been verified
          <br /> by the frontend.
        </p>
      </>,
    );
  };

  const sendPCDToServer = async () => {
    let response;
    console.log("Sending PCD to server");
    try {
      response = await fetch("/api/verify", {
        method: "POST",
        body: JSON.stringify({
          pcd: pcd,
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
    } catch (e) {
      notification.error(`Error: ${e}`);
      return;
    }

    const data = await response.json();
    setVerifiedBackend(true);
    notification.success(
      <>
        <p className="font-bold m-0">Backend Verified!</p>
        <p className="m-0">{data?.message}</p>
      </>,
    );
  };

  // mintItem verifies the proof on-chain and mints an NFT
  const { writeContractAsync: mintNFT, isPending: isMintingNFT } = useScaffoldWriteContract("YourCollectible");

  return (
    <>
      <div className="flex flex-col items-center mt-24">
        <div className="card max-w-[90%] sm:max-w-lg bg-base-100 shadow-xl">
          <div className="card-body">
            <h2 className="card-title text-2xl font-bold mb-4">Zupass: Private Voting</h2>
            <div className="flex flex-col gap-6 mt-6">
              <div className="tooltip" data-tip="Loads the Zupass UI in a modal, where you can prove your PCD.">
                <button className="btn btn-secondary w-full tooltip" onClick={getProof} disabled={!!pcd}>
                  {!pcd ? "1. Prove Membership" : "1. Proof Received!"}
                </button>
              </div>
              <div className="tooltip" data-tip="When you get back the PCD, verify it on the frontend.">
                <button
                  className="btn btn-primary w-full"
                  disabled={!pcd || verifiedFrontend}
                  onClick={verifyProofFrontend}
                >
                  2. Verify (frontend)
                </button>
              </div>
              {["project1", "project2", "project3"].map((project, index) => (
                <div key={project} className="tooltip flex flex-col gap-2" data-tip={`Vote for ${project}`}>
                  <h3 className="text-lg font-semibold">{`Project ${index + 1}`}</h3>
                  <input
                    type="number"
                    value={inputValues[project]}
                    onChange={e => handleInputChange(e, project)}
                    placeholder="Enter a number"
                    className="input input-bordered w-full"
                  />
                </div>
              ))}
              <button
                className="btn btn-primary w-full mt-4"
                disabled={!verifiedFrontend || verifiedBackend}
                onClick={() =>
                  handleClick([
                    BigInt(inputValues.project1),
                    BigInt(inputValues.project2),
                    BigInt(inputValues.project3),
                  ])
                }
              >
                Vote
              </button>
              <div className="flex justify-center mt-4">
                <button
                  className="btn btn-ghost text-error underline normal-case"
                  onClick={() => setVerifiedFrontend(false)}
                >
                  Reset
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Home;
